const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Model weights are native assets (android/app/src/main/assets/models), never
 * Metro assets, so they are excluded here. Bundling a 77 MB ggml file through
 * Metro would duplicate it inside the JS bundle.
 */
const config = {
  resolver: {
    assetExts: getDefaultConfig(__dirname).resolver.assetExts.filter(
      ext => ext !== 'bin' && ext !== 'gguf' && ext !== 'onnx',
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
