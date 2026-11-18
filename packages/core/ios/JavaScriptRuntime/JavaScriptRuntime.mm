// The bridge between Bridge.swift and Hermes, through JSI: the iOS side of android/src/main/cpp/bridge.cpp.
// Values cross as Foundation objects. Every call happens on the JS queue.
#import "NativueJavaScriptRuntime.h"

#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <functional>
#include <memory>
#include <string>
#include <vector>

using namespace facebook;

namespace {

// ---------- Strings (UTF-16 both ways, so emoji survive) ----------

NSString *toObjectiveCString(jsi::Runtime &runtime, const jsi::String &string) {
  std::u16string text = string.utf16(runtime);

  return [NSString stringWithCharacters:reinterpret_cast<const unichar *>(text.data()) length:text.size()];
}

jsi::String toJavaScriptString(jsi::Runtime &runtime, NSString *string) {
  std::vector<unichar> characters(string.length);
  [string getCharacters:characters.data() range:NSMakeRange(0, string.length)];

  return jsi::String::createFromUtf16(
      runtime, reinterpret_cast<const char16_t *>(characters.data()), characters.size());
}

std::string toStdString(NSString *string) {
  return string.UTF8String ?: "";
}

NSString *toObjectiveCString(const std::string &string) {
  return [NSString stringWithUTF8String:string.c_str()] ?: @"";
}

// ---------- Values ----------

id toObjectiveC(jsi::Runtime &runtime, const jsi::Value &value);

NSArray *arrayToObjectiveC(jsi::Runtime &runtime, const jsi::Array &array) {
  size_t length = array.size(runtime);
  NSMutableArray *elements = [NSMutableArray arrayWithCapacity:length];

  for (size_t index = 0; index < length; index++) {
    [elements addObject:toObjectiveC(runtime, array.getValueAtIndex(runtime, index))];
  }

  return elements;
}

NSDictionary *objectToObjectiveC(jsi::Runtime &runtime, const jsi::Object &object) {
  jsi::Array names = object.getPropertyNames(runtime);
  size_t count = names.size(runtime);
  NSMutableDictionary *properties = [NSMutableDictionary dictionaryWithCapacity:count];

  for (size_t index = 0; index < count; index++) {
    jsi::String name = names.getValueAtIndex(runtime, index).getString(runtime);
    jsi::Value value = object.getProperty(runtime, jsi::PropNameID::forString(runtime, name));
    if (value.isUndefined()) continue; // `{ badge: undefined }` reads as no badge, not as null

    properties[toObjectiveCString(runtime, name)] = toObjectiveC(runtime, value);
  }

  return properties;
}

// null, undefined, functions and other non-data values become NSNull.
id toObjectiveC(jsi::Runtime &runtime, const jsi::Value &value) {
  if (value.isBool()) return value.getBool() ? @YES : @NO;
  if (value.isNumber()) return @(value.getNumber());
  if (value.isString()) return toObjectiveCString(runtime, value.getString(runtime));
  if (!value.isObject()) return NSNull.null;

  jsi::Object object = value.getObject(runtime);
  if (object.isFunction(runtime)) return NSNull.null;
  if (object.isArray(runtime)) return arrayToObjectiveC(runtime, object.getArray(runtime));

  return objectToObjectiveC(runtime, object);
}

jsi::Value toJavaScript(jsi::Runtime &runtime, id value);

jsi::Value arrayToJavaScript(jsi::Runtime &runtime, NSArray *elements) {
  jsi::Array array(runtime, elements.count);

  for (NSUInteger index = 0; index < elements.count; index++) {
    array.setValueAtIndex(runtime, index, toJavaScript(runtime, elements[index]));
  }

  return array;
}

// Keys that aren't strings (HTTP header fields can be anything) use their description.
jsi::Value dictionaryToJavaScript(jsi::Runtime &runtime, NSDictionary *properties) {
  jsi::Object object(runtime);

  for (id key in properties) {
    object.setProperty(runtime, toJavaScriptString(runtime, [key description]), toJavaScript(runtime, properties[key]));
  }

  return object;
}

jsi::Value toJavaScript(jsi::Runtime &runtime, id value) {
  if (value == nil || value == NSNull.null) return jsi::Value::null();
  if ([value isKindOfClass:NSNumber.class]) {
    if (CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) return jsi::Value([value boolValue]);

    return jsi::Value([value doubleValue]);
  }
  if ([value isKindOfClass:NSString.class]) return toJavaScriptString(runtime, value);
  if ([value isKindOfClass:NSArray.class]) return arrayToJavaScript(runtime, value);
  if ([value isKindOfClass:NSDictionary.class]) return dictionaryToJavaScript(runtime, value);

  return jsi::Value::undefined();
}

// ---------- Bundle ----------

// Hermes runs bytecode straight from the buffer, so it keeps the data alive as long as it needs it.
class DataBuffer : public jsi::Buffer {
 public:
  explicit DataBuffer(NSData *data) : data_(data) {}

  size_t size() const override {
    return data_.length;
  }

  const uint8_t *data() const override {
    return static_cast<const uint8_t *>(data_.bytes);
  }

 private:
  NSData *data_;
};

}  // namespace

@implementation NativueJavaScriptRuntime {
  std::unique_ptr<facebook::hermes::HermesRuntime> _hermes;
  void (^_onError)(NSString *, NSString *);
}

- (instancetype)initWithFunctions:(NSDictionary<NSString *, id> *)functions
                          onError:(void (^)(NSString *, NSString *))onError {
  self = [super init];
  if (self == nil) return nil;

  auto config = ::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build();
  _hermes = facebook::hermes::makeHermesRuntime(config);
  _onError = onError;
  [self installNativeModule:functions];

  return self;
}

- (void)installNativeModule:(NSDictionary<NSString *, id> *)functions {
  jsi::Runtime &runtime = *_hermes;
  jsi::Object nativeModule(runtime);

  for (NSString *name in functions) {
    NativueNativeFunction function = functions[name];
    auto call = [function](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *arguments, size_t count) {
      NSMutableArray *objectiveCArguments = [NSMutableArray arrayWithCapacity:count];
      for (size_t position = 0; position < count; position++) {
        [objectiveCArguments addObject:toObjectiveC(runtime, arguments[position])];
      }

      return toJavaScript(runtime, function(objectiveCArguments));
    };

    std::string functionName = toStdString(name);
    nativeModule.setProperty(
        runtime,
        functionName.c_str(),
        jsi::Function::createFromHostFunction(runtime, jsi::PropNameID::forUtf8(runtime, functionName), 0, call));
  }

  runtime.global().setProperty(runtime, "__native", nativeModule);
}

- (void)evaluate:(NSData *)bundle sourceURL:(NSString *)sourceURL {
  auto buffer = std::make_shared<DataBuffer>(bundle);
  std::string url = toStdString(sourceURL);

  [self runReportingErrors:[&] { _hermes->evaluateJavaScript(buffer, url); }];
}

- (void)call:(NSString *)functionName arguments:(NSArray *)arguments {
  jsi::Runtime &runtime = *_hermes;
  std::string name = toStdString(functionName);

  [self runReportingErrors:[&] {
    jsi::Value function = runtime.global().getProperty(runtime, name.c_str());
    if (!function.isObject() || !function.getObject(runtime).isFunction(runtime)) return;

    std::vector<jsi::Value> values;
    for (id argument in arguments) values.push_back(toJavaScript(runtime, argument));

    function.getObject(runtime).getFunction(runtime).call(
        runtime, static_cast<const jsi::Value *>(values.data()), values.size());
  }];
}

// Runs `work` and the promise jobs it queued, reporting errors instead of throwing them. A failing job
// doesn't stop the others.
- (void)runReportingErrors:(const std::function<void()> &)work {
  auto attempt = [self](const std::function<void()> &step) {
    try {
      step();
      return true;
    } catch (const jsi::JSError &error) {
      _onError(toObjectiveCString(error.getMessage()), toObjectiveCString(error.getStack()));
    } catch (const std::exception &error) {
      _onError(toObjectiveCString(error.what()), @"");
    }

    return false;
  };

  attempt(work);
  while (!attempt([self] { _hermes->drainMicrotasks(); })) {
  }
}

@end
