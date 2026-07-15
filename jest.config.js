module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: [
    'src/utils/delivery-assignment.utils.js',
    'src/services/dispatch.service.js',
  ],
  coveragePathIgnorePatterns: ['/node_modules/'],
  verbose: true,
};
