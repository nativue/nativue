# bridge.cpp calls these through JNI.
-keep class dev.nativue.JavaScriptRuntime { *; }

# Hermes (its Intl is written in Java), Yoga and fbjni look their Java classes, fields and methods up
# by name from native code, and their AARs ship no rules of their own.
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.yoga.** { *; }
-keep class com.facebook.jni.** { *; }
