import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}

android {
    namespace = "com.toolseer.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.toolseer.app"
        minSdk = 26
        targetSdk = 36
        // The owner's scheme: the first public release is 1.3, not 1.0, because the
        // project was rebuilt several times before it shipped. versionCode must only
        // ever increase — Play rejects a reused or lowered one.
        versionCode = 3
        versionName = "1.3"
    }

    if (keystorePropsFile.exists()) {
        signingConfigs {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false          // the app is a shell around our own JS
            isShrinkResources = false
            if (keystorePropsFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
}

/**
 * Copy the published site into the APK.
 *
 * The app must ship EXACTLY the tree the 558 static checks and 113 tests verify, so
 * it is copied at build time from ../../web rather than duplicated. A copy that drifts
 * is a copy that ships a bug the gates already fixed.
 */
val syncWeb = tasks.register<Copy>("syncWeb") {
    from("../../../web")
    into(layout.projectDirectory.dir("src/main/assets/www"))
    exclude("**/*.map")
}

tasks.named("preBuild") { dependsOn(syncWeb) }
