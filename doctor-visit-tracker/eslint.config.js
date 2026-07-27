// Flat ESLint config. `eslint-config-expo` carries the React Native, React
// Hooks and import rules that match Expo SDK 57, including the TypeScript
// plugin — so the override below only has to adjust rule settings.
const expoConfig = require('eslint-config-expo/flat');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  ...expoConfig,
  {
    ignores: ['node_modules/**', 'dist/**', '.expo/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // The base rule cannot see TypeScript type positions and reports every
      // parameter name in an interface as unused. The TypeScript-aware rule
      // does the same job correctly, so the base one is turned off.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.js'],
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
];
