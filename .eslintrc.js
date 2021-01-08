module.exports = {
  parser: '@typescript-eslint/parser',
  extends: ['airbnb', 'plugin:@typescript-eslint/recommended', 'prettier/@typescript-eslint'],
  plugins: ['@typescript-eslint', 'prettier'],
  settings: {
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts'],
    },
    'import/resolver': {
      typescript: {},
    },
  },
  env: {
    browser: true,
    node: true,
  },
  rules: {
    'import/prefer-default-export': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    indent: 'off',
    'function-paren-newline': 'off',
    'space-before-function-paren': 'off',
    '@typescript-eslint/space-before-function-paren': ['error'],
    'no-restricted-syntax': ['error', 'LabeledStatement', 'WithStatement'],
    'no-await-in-loop': 'off',
    'implicit-arrow-linebreak': 'off', // conflicts with prettier
    'no-unused-expressions': 'off', // breaks optional chaining
    '@typescript-eslint/no-unused-expressions': 'error',
    'max-len': ['error', { code: 120, ignoreComments: true }],
    '@typescript-eslint/no-empty-function': 'off',
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-non-null-assertion': 'error',
    'operator-linebreak': 'off',
    'no-param-reassign': ['error', { props: false }],
    'object-curly-newline': 'off',
    'consistent-return': 'off',
  },
};
