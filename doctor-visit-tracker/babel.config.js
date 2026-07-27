// Expo's preset already wires up expo-router and react-native-worklets
// (which react-native-reanimated 4 depends on). Keeping this file explicit
// makes the build reproducible rather than relying on autodetection.
module.exports = function (api) {
  api.cache(true);
  return { presets: [['babel-preset-expo', { reanimated: true }]] };
};
