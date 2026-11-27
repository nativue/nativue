// JNI bridge between dev.nativue.JavaScriptRuntime (Kotlin) and Hermes, through JSI. Values cross as
// plain Java objects: null, Boolean, Double, String, ByteArray (from an ArrayBuffer or a typed array, back
// as a Uint8Array), ArrayList and HashMap (and back from any Number, List, Map or Object[]). Every call
// happens on the JS thread.
#include <hermes/hermes.h>
#include <jni.h>
#include <jsi/jsi.h>

#include <memory>
#include <optional>
#include <string>
#include <vector>

using namespace facebook;

namespace {

JavaVM* javaVM;

struct JavaTypes {
  jclass object, boolean, number, doubleClass, string, byteArray, list, arrayList, map, hashMap, objectArray;
  jmethodID booleanValueOf, booleanValue, doubleValueOf, numberDoubleValue;
  jmethodID listSize, listGet, arrayListInit, arrayListAdd;
  jmethodID mapKeys, mapGet, hashMapInit, hashMapPut, setToArray;
  jmethodID callNative, reportError;
};

JavaTypes types;

jclass globalClass(JNIEnv* env, const char* name) {
  jclass localClass = env->FindClass(name);
  auto globalClass = static_cast<jclass>(env->NewGlobalRef(localClass));
  env->DeleteLocalRef(localClass);

  return globalClass;
}

JNIEnv* currentEnvironment() {
  JNIEnv* env = nullptr;
  javaVM->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);

  return env;
}

// One per JavaScriptRuntime: the Hermes runtime and the Kotlin object that receives its calls.
struct Runtime {
  std::unique_ptr<facebook::hermes::HermesRuntime> hermes;
  jobject owner;
};

// Calls the Kotlin native function at `index` with one string, outside any JS call: no JS value to
// return, no JS error to throw.
void callNativeWithString(jobject owner, jint index, const std::string& argument) {
  JNIEnv* env = currentEnvironment();
  if (env == nullptr) return;

  env->PushLocalFrame(4);
  jobjectArray arguments = env->NewObjectArray(1, types.object, env->NewStringUTF(argument.c_str()));
  env->CallObjectMethod(owner, types.callNative, index, arguments);
  if (env->ExceptionCheck()) env->ExceptionClear();
  env->PopLocalFrame(nullptr);
}

// ---------- Strings (UTF-16 both ways, so emoji survive) ----------

jstring toJavaString(JNIEnv* env, jsi::Runtime& runtime, const jsi::String& string) {
  std::u16string text = string.utf16(runtime);

  return env->NewString(reinterpret_cast<const jchar*>(text.data()), static_cast<jsize>(text.size()));
}

jsi::String toJavaScriptString(JNIEnv* env, jsi::Runtime& runtime, jstring string) {
  const jchar* characters = env->GetStringChars(string, nullptr);
  auto text = jsi::String::createFromUtf16(
      runtime, reinterpret_cast<const char16_t*>(characters), env->GetStringLength(string));
  env->ReleaseStringChars(string, characters);

  return text;
}

std::string toStdString(JNIEnv* env, jstring string) {
  const char* characters = env->GetStringUTFChars(string, nullptr);
  std::string text(characters);
  env->ReleaseStringUTFChars(string, characters);

  return text;
}

// ---------- Bytes ----------

struct Bytes {
  const uint8_t* data;
  size_t size;
};

// An ArrayBuffer, or what a typed array or DataView sees of one. Not copied: use before calling JS again.
std::optional<Bytes> bytesOf(jsi::Runtime& runtime, const jsi::Object& object) {
  if (object.isArrayBuffer(runtime)) {
    jsi::ArrayBuffer buffer = object.getArrayBuffer(runtime);

    return Bytes{buffer.data(runtime), buffer.size(runtime)};
  }

  jsi::Value buffer = object.getProperty(runtime, "buffer");
  if (!buffer.isObject() || !buffer.getObject(runtime).isArrayBuffer(runtime)) return std::nullopt;

  jsi::ArrayBuffer arrayBuffer = buffer.getObject(runtime).getArrayBuffer(runtime);
  auto offset = static_cast<size_t>(object.getProperty(runtime, "byteOffset").asNumber());
  auto length = static_cast<size_t>(object.getProperty(runtime, "byteLength").asNumber());

  return Bytes{arrayBuffer.data(runtime) + offset, length};
}

class OwnedBuffer : public jsi::MutableBuffer {
 public:
  explicit OwnedBuffer(std::vector<uint8_t> bytes) : bytes_(std::move(bytes)) {}

  size_t size() const override {
    return bytes_.size();
  }

  uint8_t* data() override {
    return bytes_.data();
  }

 private:
  std::vector<uint8_t> bytes_;
};

jsi::Value uint8Array(jsi::Runtime& runtime, std::vector<uint8_t> bytes) {
  jsi::ArrayBuffer buffer(runtime, std::make_shared<OwnedBuffer>(std::move(bytes)));

  return runtime.global().getPropertyAsFunction(runtime, "Uint8Array").callAsConstructor(runtime, buffer);
}

// ---------- Values ----------

jobject toJava(JNIEnv* env, jsi::Runtime& runtime, const jsi::Value& value);

jobject arrayToJava(JNIEnv* env, jsi::Runtime& runtime, const jsi::Array& array) {
  size_t length = array.size(runtime);
  jobject list = env->NewObject(types.arrayList, types.arrayListInit, static_cast<jint>(length));

  for (size_t index = 0; index < length; index++) {
    jobject element = toJava(env, runtime, array.getValueAtIndex(runtime, index));
    env->CallBooleanMethod(list, types.arrayListAdd, element);
    env->DeleteLocalRef(element);
  }

  return list;
}

jobject objectToJava(JNIEnv* env, jsi::Runtime& runtime, const jsi::Object& object) {
  jsi::Array names = object.getPropertyNames(runtime);
  size_t count = names.size(runtime);
  jobject map = env->NewObject(types.hashMap, types.hashMapInit, static_cast<jint>(count));

  for (size_t index = 0; index < count; index++) {
    jsi::String name = names.getValueAtIndex(runtime, index).getString(runtime);
    jstring key = toJavaString(env, runtime, name);
    jobject value = toJava(env, runtime, object.getProperty(runtime, jsi::PropNameID::forString(runtime, name)));
    env->DeleteLocalRef(env->CallObjectMethod(map, types.hashMapPut, key, value));
    env->DeleteLocalRef(key);
    env->DeleteLocalRef(value);
  }

  return map;
}

jbyteArray bytesToJava(JNIEnv* env, const Bytes& bytes) {
  jbyteArray array = env->NewByteArray(static_cast<jsize>(bytes.size));
  env->SetByteArrayRegion(array, 0, static_cast<jsize>(bytes.size), reinterpret_cast<const jbyte*>(bytes.data));

  return array;
}

// Functions and other non-data values become null.
jobject toJava(JNIEnv* env, jsi::Runtime& runtime, const jsi::Value& value) {
  if (value.isBool()) return env->CallStaticObjectMethod(types.boolean, types.booleanValueOf, value.getBool());
  if (value.isNumber()) return env->CallStaticObjectMethod(types.doubleClass, types.doubleValueOf, value.getNumber());
  if (value.isString()) return toJavaString(env, runtime, value.getString(runtime));
  if (!value.isObject()) return nullptr;

  jsi::Object object = value.getObject(runtime);
  if (object.isFunction(runtime)) return nullptr;
  if (object.isArray(runtime)) return arrayToJava(env, runtime, object.getArray(runtime));
  if (auto bytes = bytesOf(runtime, object)) return bytesToJava(env, *bytes);

  return objectToJava(env, runtime, object);
}

jsi::Value toJavaScript(JNIEnv* env, jsi::Runtime& runtime, jobject value);

jsi::Value listToJavaScript(JNIEnv* env, jsi::Runtime& runtime, jobject list) {
  jint length = env->CallIntMethod(list, types.listSize);
  jsi::Array array(runtime, length);

  for (jint index = 0; index < length; index++) {
    jobject element = env->CallObjectMethod(list, types.listGet, index);
    array.setValueAtIndex(runtime, index, toJavaScript(env, runtime, element));
    env->DeleteLocalRef(element);
  }

  return array;
}

jsi::Value objectArrayToJavaScript(JNIEnv* env, jsi::Runtime& runtime, jobjectArray elements) {
  jsize length = env->GetArrayLength(elements);
  jsi::Array array(runtime, length);

  for (jsize index = 0; index < length; index++) {
    jobject element = env->GetObjectArrayElement(elements, index);
    array.setValueAtIndex(runtime, index, toJavaScript(env, runtime, element));
    env->DeleteLocalRef(element);
  }

  return array;
}

jsi::Value mapToJavaScript(JNIEnv* env, jsi::Runtime& runtime, jobject map) {
  jsi::Object object(runtime);
  jobject keySet = env->CallObjectMethod(map, types.mapKeys);
  auto keys = static_cast<jobjectArray>(env->CallObjectMethod(keySet, types.setToArray));

  for (jsize index = 0; index < env->GetArrayLength(keys); index++) {
    auto key = static_cast<jstring>(env->GetObjectArrayElement(keys, index));
    jobject value = env->CallObjectMethod(map, types.mapGet, key);
    object.setProperty(runtime, toJavaScriptString(env, runtime, key), toJavaScript(env, runtime, value));
    env->DeleteLocalRef(key);
    env->DeleteLocalRef(value);
  }
  env->DeleteLocalRef(keys);
  env->DeleteLocalRef(keySet);

  return object;
}

jsi::Value toJavaScript(JNIEnv* env, jsi::Runtime& runtime, jobject value) {
  if (value == nullptr) return jsi::Value::null();
  if (env->IsInstanceOf(value, types.boolean)) {
    return jsi::Value(static_cast<bool>(env->CallBooleanMethod(value, types.booleanValue)));
  }
  if (env->IsInstanceOf(value, types.number)) {
    return jsi::Value(env->CallDoubleMethod(value, types.numberDoubleValue));
  }
  if (env->IsInstanceOf(value, types.string)) {
    return toJavaScriptString(env, runtime, static_cast<jstring>(value));
  }
  if (env->IsInstanceOf(value, types.byteArray)) {
    auto array = static_cast<jbyteArray>(value);
    std::vector<uint8_t> bytes(env->GetArrayLength(array));
    env->GetByteArrayRegion(array, 0, static_cast<jsize>(bytes.size()), reinterpret_cast<jbyte*>(bytes.data()));

    return uint8Array(runtime, std::move(bytes));
  }
  if (env->IsInstanceOf(value, types.list)) return listToJavaScript(env, runtime, value);
  if (env->IsInstanceOf(value, types.map)) return mapToJavaScript(env, runtime, value);
  if (env->IsInstanceOf(value, types.objectArray)) {
    return objectArrayToJavaScript(env, runtime, static_cast<jobjectArray>(value));
  }

  return jsi::Value::undefined();
}

// ---------- Errors ----------

void reportError(Runtime& runtime, const std::string& message, const std::string& stack) {
  JNIEnv* env = currentEnvironment();
  jstring javaMessage = env->NewStringUTF(message.c_str());
  jstring javaStack = env->NewStringUTF(stack.c_str());
  env->CallVoidMethod(runtime.owner, types.reportError, javaMessage, javaStack);
  env->DeleteLocalRef(javaMessage);
  env->DeleteLocalRef(javaStack);
}

// Runs `work` and the promise jobs it queued, reporting errors instead of throwing them into Java. A
// failing job doesn't stop the others.
template <typename Work>
void runReportingErrors(Runtime& runtime, Work work) {
  auto attempt = [&runtime](auto step) {
    try {
      step();
      return true;
    } catch (const jsi::JSError& error) {
      reportError(runtime, error.getMessage(), error.getStack());
    } catch (const std::exception& error) {
      reportError(runtime, error.what(), "");
    }

    return false;
  };

  attempt(work);
  while (!attempt([&runtime] { runtime.hermes->drainMicrotasks(); })) {
  }
}

// ---------- Blobs ----------

// What __blobCollector returns: when the garbage collector collects it (with the last Blob that holds it),
// it releases the blob's native bytes through blobRelease.
class BlobCollector : public jsi::HostObject {
 public:
  BlobCollector(jobject owner, jint releaseIndex, std::string blobId)
      : owner_(owner), releaseIndex_(releaseIndex), blobId_(std::move(blobId)) {}

  ~BlobCollector() override {
    callNativeWithString(owner_, releaseIndex_, blobId_);
  }

 private:
  jobject owner_;
  jint releaseIndex_;
  std::string blobId_;
};

void installBlobCollector(jsi::Runtime& runtime, jobject owner, jint releaseIndex) {
  auto collector = [owner, releaseIndex](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* arguments, size_t count) {
    if (count < 1 || !arguments[0].isString()) throw jsi::JSError(runtime, "__blobCollector needs a blob id");

    auto blobCollector = std::make_shared<BlobCollector>(owner, releaseIndex, arguments[0].getString(runtime).utf8(runtime));

    return jsi::Value(runtime, jsi::Object::createFromHostObject(runtime, blobCollector));
  };

  runtime.global().setProperty(
      runtime,
      "__blobCollector",
      jsi::Function::createFromHostFunction(runtime, jsi::PropNameID::forAscii(runtime, "__blobCollector"), 1, collector));
}

// ---------- __native ----------

// A Kotlin exception thrown by a native function becomes a JS error at the call site.
void rethrowJavaException(JNIEnv* env, jsi::Runtime& runtime) {
  jthrowable exception = env->ExceptionOccurred();
  if (exception == nullptr) return;

  env->ExceptionClear();
  jclass throwableClass = env->GetObjectClass(exception);
  jmethodID toString = env->GetMethodID(throwableClass, "toString", "()Ljava/lang/String;");
  auto description = static_cast<jstring>(env->CallObjectMethod(exception, toString));
  std::string message = toStdString(env, description);
  env->DeleteLocalRef(description);
  env->DeleteLocalRef(throwableClass);
  env->DeleteLocalRef(exception);

  throw jsi::JSError(runtime, message);
}

jsi::Function nativeFunction(jsi::Runtime& runtime, jobject owner, const std::string& name, jint index) {
  auto call = [owner, index](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* arguments, size_t count) {
    JNIEnv* env = currentEnvironment();
    // One frame per call: the bundle makes thousands of calls within one JNI call.
    env->PushLocalFrame(static_cast<jint>(count) * 4 + 16);

    jobjectArray javaArguments = env->NewObjectArray(static_cast<jsize>(count), types.object, nullptr);
    for (size_t position = 0; position < count; position++) {
      jobject argument = toJava(env, runtime, arguments[position]);
      env->SetObjectArrayElement(javaArguments, static_cast<jsize>(position), argument);
      env->DeleteLocalRef(argument);
    }

    jobject result = env->CallObjectMethod(owner, types.callNative, index, javaArguments);
    if (env->ExceptionCheck()) {
      env->PopLocalFrame(nullptr);
      rethrowJavaException(currentEnvironment(), runtime);
    }

    jsi::Value value = toJavaScript(env, runtime, result);
    env->PopLocalFrame(nullptr);

    return value;
  };

  return jsi::Function::createFromHostFunction(runtime, jsi::PropNameID::forUtf8(runtime, name), 0, call);
}

void installNativeModule(Runtime& runtime, JNIEnv* env, jobjectArray functionNames) {
  jsi::Runtime& hermes = *runtime.hermes;
  jsi::Object nativeModule(hermes);

  for (jsize index = 0; index < env->GetArrayLength(functionNames); index++) {
    auto name = static_cast<jstring>(env->GetObjectArrayElement(functionNames, index));
    std::string functionName = toStdString(env, name);
    nativeModule.setProperty(hermes, functionName.c_str(), nativeFunction(hermes, runtime.owner, functionName, index));
    if (functionName == "blobRelease") installBlobCollector(hermes, runtime.owner, index);
    env->DeleteLocalRef(name);
  }

  hermes.global().setProperty(hermes, "__native", nativeModule);
}

Runtime& runtimeOf(jlong handle) {
  return *reinterpret_cast<Runtime*>(handle);
}

// A copy of a Java byte[]: JavaScript source or Hermes bytecode. Hermes runs bytecode straight from
// the buffer, so it keeps the buffer alive as long as it needs it.
class ByteBuffer : public jsi::Buffer {
 public:
  ByteBuffer(JNIEnv* env, jbyteArray array) : bytes_(env->GetArrayLength(array)) {
    env->GetByteArrayRegion(array, 0, static_cast<jsize>(bytes_.size()), reinterpret_cast<jbyte*>(bytes_.data()));
  }

  size_t size() const override {
    return bytes_.size();
  }

  const uint8_t* data() const override {
    return bytes_.data();
  }

 private:
  std::vector<uint8_t> bytes_;
};

}  // namespace

// ---------- JNI entry points (dev.nativue.JavaScriptRuntime) ----------

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void*) {
  javaVM = vm;
  JNIEnv* env = currentEnvironment();

  types.object = globalClass(env, "java/lang/Object");
  types.boolean = globalClass(env, "java/lang/Boolean");
  types.number = globalClass(env, "java/lang/Number");
  types.doubleClass = globalClass(env, "java/lang/Double");
  types.string = globalClass(env, "java/lang/String");
  types.byteArray = globalClass(env, "[B");
  types.list = globalClass(env, "java/util/List");
  types.arrayList = globalClass(env, "java/util/ArrayList");
  types.map = globalClass(env, "java/util/Map");
  types.hashMap = globalClass(env, "java/util/HashMap");
  types.objectArray = globalClass(env, "[Ljava/lang/Object;");

  types.booleanValueOf = env->GetStaticMethodID(types.boolean, "valueOf", "(Z)Ljava/lang/Boolean;");
  types.booleanValue = env->GetMethodID(types.boolean, "booleanValue", "()Z");
  types.doubleValueOf = env->GetStaticMethodID(types.doubleClass, "valueOf", "(D)Ljava/lang/Double;");
  types.numberDoubleValue = env->GetMethodID(types.number, "doubleValue", "()D");
  types.listSize = env->GetMethodID(types.list, "size", "()I");
  types.listGet = env->GetMethodID(types.list, "get", "(I)Ljava/lang/Object;");
  types.arrayListInit = env->GetMethodID(types.arrayList, "<init>", "(I)V");
  types.arrayListAdd = env->GetMethodID(types.arrayList, "add", "(Ljava/lang/Object;)Z");
  types.mapKeys = env->GetMethodID(types.map, "keySet", "()Ljava/util/Set;");
  types.mapGet = env->GetMethodID(types.map, "get", "(Ljava/lang/Object;)Ljava/lang/Object;");
  types.hashMapInit = env->GetMethodID(types.hashMap, "<init>", "(I)V");
  types.hashMapPut =
      env->GetMethodID(types.hashMap, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");

  jclass setClass = env->FindClass("java/util/Set");
  types.setToArray = env->GetMethodID(setClass, "toArray", "()[Ljava/lang/Object;");
  env->DeleteLocalRef(setClass);

  jclass runtimeClass = env->FindClass("dev/nativue/JavaScriptRuntime");
  types.callNative = env->GetMethodID(runtimeClass, "callNative", "(I[Ljava/lang/Object;)Ljava/lang/Object;");
  types.reportError = env->GetMethodID(runtimeClass, "reportError", "(Ljava/lang/String;Ljava/lang/String;)V");
  env->DeleteLocalRef(runtimeClass);

  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_nativue_JavaScriptRuntime_create(JNIEnv* env, jobject owner, jobjectArray functionNames) {
  // Off by default: a let in a loop would be one variable for every iteration, so callbacks made
  // in the loop would all see its last value. Bytecode gets the same from hermesc's -Xes6-block-scoping.
  auto config = ::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).withES6BlockScoping(true).build();
  auto runtime = new Runtime{facebook::hermes::makeHermesRuntime(config), env->NewGlobalRef(owner)};
  installNativeModule(*runtime, env, functionNames);

  return reinterpret_cast<jlong>(runtime);
}

extern "C" JNIEXPORT void JNICALL
Java_dev_nativue_JavaScriptRuntime_evaluate(JNIEnv* env, jobject, jlong handle, jbyteArray bundle, jstring sourceURL) {
  Runtime& runtime = runtimeOf(handle);
  auto buffer = std::make_shared<ByteBuffer>(env, bundle);
  std::string url = toStdString(env, sourceURL);

  runReportingErrors(runtime, [&] { runtime.hermes->evaluateJavaScript(buffer, url); });
}

extern "C" JNIEXPORT void JNICALL Java_dev_nativue_JavaScriptRuntime_call(
    JNIEnv* env, jobject, jlong handle, jstring functionName, jobjectArray arguments) {
  Runtime& runtime = runtimeOf(handle);
  jsi::Runtime& hermes = *runtime.hermes;
  std::string name = toStdString(env, functionName);

  runReportingErrors(runtime, [&] {
    jsi::Value function = hermes.global().getProperty(hermes, name.c_str());
    if (!function.isObject() || !function.getObject(hermes).isFunction(hermes)) return;

    std::vector<jsi::Value> values;
    for (jsize index = 0; index < env->GetArrayLength(arguments); index++) {
      jobject argument = env->GetObjectArrayElement(arguments, index);
      values.push_back(toJavaScript(env, hermes, argument));
      env->DeleteLocalRef(argument);
    }

    function.getObject(hermes).getFunction(hermes).call(
        hermes, static_cast<const jsi::Value*>(values.data()), values.size());
  });
}

extern "C" JNIEXPORT void JNICALL Java_dev_nativue_JavaScriptRuntime_destroy(JNIEnv* env, jobject, jlong handle) {
  Runtime* runtime = reinterpret_cast<Runtime*>(handle);
  runtime->hermes.reset();  // first: collecting its Blobs on the way out still calls the owner
  env->DeleteGlobalRef(runtime->owner);
  delete runtime;
}
