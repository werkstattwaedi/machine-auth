import * as sinon from "sinon";

// Mock firebase-admin module to avoid initialization issues
const mockFirestore = {
  collectionGroup: sinon.stub(),
  collection: sinon.stub(),
  settings: {},
  databaseId: "test",
  doc: sinon.stub(),
  getAll: sinon.stub(),
  batch: sinon.stub(),
  runTransaction: sinon.stub(),
  disableNetwork: sinon.stub(),
  enableNetwork: sinon.stub(),
  terminate: sinon.stub(),
  waitForPendingWrites: sinon.stub(),
  recursiveDelete: sinon.stub(),
  FieldPath: {
    documentId: () => "mockDocumentId",
  },
  Timestamp: {
    fromMillis: (millis: number) => ({ 
      toMillis: () => millis,
      seconds: Math.floor(millis / 1000),
      nanoseconds: (millis % 1000) * 1000000,
    }),
    now: () => ({ 
      toMillis: () => Date.now(),
      seconds: Math.floor(Date.now() / 1000),
      nanoseconds: (Date.now() % 1000) * 1000000,
    }),
  },
  FieldValue: {
    arrayUnion: (...values: any[]) => ({ 
      type: "arrayUnion", 
      values 
    }),
    arrayRemove: (...values: any[]) => ({ 
      type: "arrayRemove", 
      values 
    }),
    delete: () => ({ type: "delete" }),
    serverTimestamp: () => ({ type: "serverTimestamp" }),
    increment: (value: number) => ({ type: "increment", value }),
  },
};

export const adminMock = {
  firestore: Object.assign(
    () => mockFirestore,
    {
      FieldPath: {
        documentId: () => "mockDocumentId",
      },
      Timestamp: mockFirestore.Timestamp,
      FieldValue: mockFirestore.FieldValue,
    }
  ),
  initializeApp: sinon.stub(),
  credential: {
    applicationDefault: sinon.stub(),
    cert: sinon.stub(),
  },
  app: sinon.stub(),
};

export { mockFirestore };

// Function to setup Firebase admin mocking
export function setupFirebaseAdminMock() {
  const Module = require("module");
  const originalRequire = Module.prototype.require;
  
  Module.prototype.require = function(id: string) {
    if (id === "firebase-admin") {
      return adminMock;
    }
    return originalRequire.apply(this, arguments);
  };
  
  return () => {
    Module.prototype.require = originalRequire;
  };
}

// Helper to create common Firebase mocks
export function createFirebaseMocks() {
  const mockDoc = {
    exists: true,
    data: () => ({ active: true }),
  };

  const mockCollection = {
    add: sinon.stub().resolves({ id: "mock-session-id" }),
    doc: sinon.stub().returns({
      id: "mock-session-id",
      set: sinon.stub().resolves(),
      get: sinon.stub().resolves(mockDoc),
      update: sinon.stub().resolves(),
      delete: sinon.stub().resolves(),
    }),
  };

  const mockQuery = {
    empty: true,
    docs: [],
  };

  const mockCollectionGroup = {
    where: sinon.stub().returnsThis(),
    limit: sinon.stub().returnsThis(),
    get: sinon.stub().resolves(mockQuery),
  };

  // Reset the mock firestore behavior
  mockFirestore.collectionGroup = sinon.stub().returns(mockCollectionGroup);
  mockFirestore.collection = sinon.stub().returns(mockCollection);

  return {
    mockQuery,
    mockCollectionGroup,
    mockCollection,
    mockFirestore,
    mockDoc,
  };
}