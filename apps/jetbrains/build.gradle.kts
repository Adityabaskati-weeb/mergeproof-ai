plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.5.0"
}

group = "ai.mergeproof"
version = "0.1.0"

repositories { mavenCentral(); intellijPlatform { defaultRepositories() } }

dependencies { intellijPlatform { intellijIdeaCommunity("2024.3.5") } }

intellijPlatform { pluginConfiguration { ideaVersion { sinceBuild = "243" } } }
