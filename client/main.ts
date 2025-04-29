import { app, BrowserWindow, screen, ipcMain } from 'electron';
import * as path from 'path';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null = null;
const args = process.argv.slice(1);
const serve = args.some((val) => val === '--serve');

function createWindow(): BrowserWindow {
  const size = screen.getPrimaryDisplay().workAreaSize;

  // Create the browser window.
  mainWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: true, // Be cautious with this in production
      allowRunningInsecureContent: serve, // Allow loading from webpack dev server
      contextIsolation: false, // Important for Angular/Electron interaction if nodeIntegration is true
      preload: path.join(__dirname, 'preload.js'), // Optional: Use a preload script for security
    },
  });

  if (serve) {
    // If in serve mode (development), load from the Angular dev server
    // You might need to install 'electron-reload'
    // require('electron-reload')(__dirname, {
    //   electron: require(path.join(__dirname, '..', 'node_modules', 'electron'))
    // });
    mainWindow.loadURL('http://localhost:4200'); // Default Angular dev server URL
    mainWindow.webContents.openDevTools(); // Open dev tools automatically
  } else {
    // Load the index.html of the built Angular app.
    // Adjust the path based on your angular.json outputPath
    const indexPath = path.join(__dirname, 'client/browser/index.html'); // Assumes outputPath is 'dist'
    // const indexPath = path.join(__dirname, '../dist/<your-app-name>/index.html'); // If using default output path

    // Construct the URL properly using the file protocol
    const indexUrl = new URL(`file://${indexPath}`).toString();
    mainWindow.loadURL(indexUrl);
  }

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  return mainWindow;
}

try {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.on('ready', () => {
    createWindow();

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Example of IPC communication (optional)
  ipcMain.on('message-from-renderer', (event, arg) => {
    console.log('Message received from Angular:', arg);
    // Reply to the renderer process
    event.reply('reply-from-main', 'Message received!');
  });
} catch (e) {
  // Catch Error
  // throw e; // Uncomment to debug startup errors
  console.error('Electron startup error:', e);
  app.quit();
}
