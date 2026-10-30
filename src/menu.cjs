const COMMANDS = Object.freeze({
  OPEN: 'open', PRINT: 'print', BACK: 'history-back', HOME: 'history-home', FORWARD: 'history-forward',
  ZOOM_IN: 'zoom-in', ZOOM_OUT: 'zoom-out', ZOOM_RESET: 'zoom-reset', UPDATE: 'update'
});

function buildMenuTemplate({ platform = process.platform, command }) {
  const item = (label, accelerator, name) => ({ label, accelerator, click: () => command(name) });
  const template = [];
  if (platform === 'darwin') template.push({ label: 'DownToRead', submenu: [
    { role: 'about' }, { type: 'separator' }, { role: 'services', submenu: [] },
    { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
    { type: 'separator' }, { role: 'quit' }
  ] });
  template.push({ label: 'File', submenu: [
    item('Open…', 'CmdOrCtrl+O', COMMANDS.OPEN),
    item('Print…', 'CmdOrCtrl+P', COMMANDS.PRINT),
    { type: 'separator' }, { role: platform === 'darwin' ? 'close' : 'quit' }
  ] });
  template.push({ label: 'Edit', submenu: [
    { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }
  ] });
  template.push({ label: 'Navigate', submenu: [
    item('Back', platform === 'darwin' ? 'Cmd+[' : 'Alt+Left', COMMANDS.BACK),
    item('Start Page', 'CmdOrCtrl+Shift+H', COMMANDS.HOME),
    item('Forward', platform === 'darwin' ? 'Cmd+]' : 'Alt+Right', COMMANDS.FORWARD)
  ] });
  template.push({ label: 'View', submenu: [
    item('Zoom In', 'CmdOrCtrl+Plus', COMMANDS.ZOOM_IN),
    item('Zoom Out', 'CmdOrCtrl+-', COMMANDS.ZOOM_OUT),
    item('Actual Size', 'CmdOrCtrl+0', COMMANDS.ZOOM_RESET)
  ] });
  template.push({ label: 'Help', submenu: [item('Check for Updates…', null, COMMANDS.UPDATE)] });
  if (platform === 'darwin') template.splice(template.length - 1, 0, { label: 'Window', submenu: [
    { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }
  ] });
  return template;
}
module.exports = { buildMenuTemplate, COMMANDS };
