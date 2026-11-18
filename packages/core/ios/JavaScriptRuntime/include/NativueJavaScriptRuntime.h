#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef id _Nullable (^NativueNativeFunction)(NSArray *arguments);

/**
 * A Hermes runtime (JavaScriptRuntime.mm) with `functions` (NativueNativeFunction blocks: Swift closures
 * converted with `as @convention(block)`) installed as `globalThis.__native`. Values
 * cross as NSNull, NSNumber (booleans as kCFBooleanTrue/False), NSString, NSArray and NSDictionary. Use
 * it from one thread at a time.
 */
NS_SWIFT_NAME(JavaScriptRuntime)
@interface NativueJavaScriptRuntime : NSObject

- (instancetype)initWithFunctions:(NSDictionary<NSString *, id> *)functions
                          onError:(void (^)(NSString *message, NSString *stack))onError NS_DESIGNATED_INITIALIZER;

- (instancetype)init NS_UNAVAILABLE;

/// JavaScript (UTF-8) or Hermes bytecode: Hermes tells them apart.
- (void)evaluate:(NSData *)bundle sourceURL:(NSString *)sourceURL;

/// Calls a global function, if the bundle defined it.
- (void)call:(NSString *)functionName arguments:(NSArray *)arguments;

@end

NS_ASSUME_NONNULL_END
