function configureUpdater(updater, dialog) {
  let silentCheck = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.on('update-not-available', () => {
    if (!silentCheck) dialog.showMessageBox({ type: 'info', title: 'DownToRead', message: 'DownToRead is up to date.' });
    silentCheck = false;
  });
  updater.on('error', (error) => {
    if (!silentCheck) dialog.showErrorBox('Update error', error?.message || String(error));
    silentCheck = false;
  });
  updater.on('update-available', async (info) => {
    silentCheck = false;
    const answer = await dialog.showMessageBox({ type: 'info', buttons: ['Download', 'Later'], defaultId: 1, cancelId: 1, message: `DownToRead ${info.version} is available.` });
    if (answer.response === 0) await updater.downloadUpdate();
  });
  updater.on('update-downloaded', async () => {
    const answer = await dialog.showMessageBox({ type: 'info', buttons: ['Install and restart', 'Later'], defaultId: 1, cancelId: 1, message: 'The update is ready to install.' });
    if (answer.response === 0) updater.quitAndInstall(false, true);
  });
  return async function checkForUpdates({ silent = false } = {}) {
    silentCheck = silent;
    try { return await updater.checkForUpdates(); }
    catch { return null; }
  };
}
module.exports = { configureUpdater };
