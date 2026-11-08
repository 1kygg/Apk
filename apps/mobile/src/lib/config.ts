import { Platform } from 'react-native';
const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
export const configuration = Object.freeze({
  apiUrl,
  apiConfigured: /^https:\/\//.test(apiUrl) || (__DEV__ && /^http:\/\//.test(apiUrl)),
  googleWebClientId: webClientId,
  googleIosClientId: iosClientId,
  googleConfigured: !!webClientId && (Platform.OS !== 'ios' || !!iosClientId),
  appleAvailable: Platform.OS === 'ios',
  mapConfigured: Platform.OS === 'ios' || !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
});
