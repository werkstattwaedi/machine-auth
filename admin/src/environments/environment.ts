export const environment = {
  production: false,
  useEmulators: true,
  firebase: {
    apiKey: 'fake-api-key-for-emulator',
    authDomain: 'localhost',
    projectId: 'oww-maschinenfreigabe',
    storageBucket: 'oww-maschinenfreigabe.firebasestorage.app',
    messagingSenderId: 'fake-sender-id',
    appId: 'fake-app-id-for-emulator',
  },
  firebaseFunctionsUrl: 'http://127.0.0.1:5001/oww-maschinenfreigabe/us-central1/api',
};
