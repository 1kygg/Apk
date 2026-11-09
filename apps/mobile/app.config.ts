import type { ConfigContext, ExpoConfig } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Consta',
  slug: 'consta',
  icon: './assets/icon.png',
  version: '1.1.0',
  orientation: 'portrait',
  scheme: 'consta',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'app.consta.mobile',
    supportsTablet: true,
    infoPlist: {
      NSMotionUsageDescription: 'Permite contar passos apenas quando você ativar esta função no cardio.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'app.consta.mobile',
    versionCode: 2,
    allowBackup: false,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0D0F0E' },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: true,
    permissions: ['android.permission.ACTIVITY_RECOGNITION'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      'android.permission.READ_CONTACTS',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    ],

  },
  plugins: [
    ['expo-build-properties', {
      android: {
        minSdkVersion: 26,
        compileSdkVersion: 36,
        targetSdkVersion: 36,
        usesCleartextTraffic: false,
      },
      ios: { deploymentTarget: '15.1' },
    }],
    ['expo-location', {
      locationWhenInUsePermission: 'O Consta usa sua localização para registrar o percurso do cardio iniciado por você.',
      locationAlwaysAndWhenInUsePermission: 'Se você ativar o registro com a tela bloqueada, o Consta continuará registrando somente durante a sessão.',
      isAndroidBackgroundLocationEnabled: false,
      isAndroidForegroundServiceEnabled: true,
      isIosBackgroundLocationEnabled: true,
    }],
    ['expo-notifications', { color: '#72a68b' }],
    ['expo-image-picker', {
      photosPermission: 'Escolha uma imagem para seu avatar opcional.',
      cameraPermission: false,
      microphonePermission: false,
    }],
  ],
});
