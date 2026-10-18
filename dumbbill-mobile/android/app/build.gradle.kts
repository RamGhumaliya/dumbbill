plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "in.dumbbill.dumbbill_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // The real application id is set per flavor below (in.dumbbill.owner / in.dumbbill.customer).
        // Sentry (error tracking) needs Android 8 (API 26) or newer. Android 8+ covers virtually every phone in use.
        minSdk = maxOf(flutter.minSdkVersion, 26)
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // ---- Flavors -------------------------------------------------------------------------------------------
    // Two dimensions give four variants: ownerDev, ownerProd, customerDev, customerProd.
    //   app: owner | customer   which of the two apps (each has its own id, so both can be installed together)
    //   env: dev | prod         the ONLY two environments (no staging). Dev gets the ".dev" id suffix and
    //                           "(dev)" in its name, so a dev build never replaces or mixes with the live app.
    // Run one with:  flutter run --flavor ownerDev -t lib/main_owner.dart --dart-define-from-file=config/dev.json
    flavorDimensions += listOf("app", "env")
    productFlavors {
        create("owner") {
            dimension = "app"
            applicationId = "in.dumbbill.owner"
        }
        create("customer") {
            dimension = "app"
            applicationId = "in.dumbbill.customer"
        }
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
        }
        create("prod") {
            dimension = "env"
        }
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

// The name shown under the icon: "Dumbbill Owner", "Dumbbill", with " (dev)" added for dev builds.
androidComponents {
    onVariants { variant ->
        val flavors = variant.productFlavors.toMap()
        val base = if (flavors["app"] == "owner") "Dumbbill Owner" else "Dumbbill"
        variant.manifestPlaceholders.put("appName", if (flavors["env"] == "dev") "$base (dev)" else base)
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
