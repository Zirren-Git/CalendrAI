module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // zod v4 ships ESM with `export * as ns from`, which the React Native
    // preset does not transform. Metro needs it lowered to CommonJS.
    '@babel/plugin-transform-export-namespace-from',
  ],
};
