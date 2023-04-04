import {app, dialog, BrowserWindow, ipcMain, Menu, protocol, Tray} from 'electron'
import {createProtocol, installVueDevtools} from 'vue-cli-plugin-electron-builder/lib'
import Database from "@/services/database";
import Timeline from "@/services/timeline";
import Processes from "@/services/processes";
import ProcessGraph from "@/services/process_graph";
import DailyPieChart from "@/services/daily_pie_chart";
import Heartbeat from "@/services/heartbeat";
import AutoUpdater from "@/services/auto_updater";
import AutoLaunch from 'auto-launch';
import path from 'path';
import log from 'electron-log'
import Settings from "@/services/settings";
import Entryinputs from "@/services/entryinputs";
import Exporter from "@/services/exporter";
import Customers from "@/services/customers";
import Projects from "@/services/projects";
import {scheduleJob} from 'node-schedule'
import DatabaseConversionService from "@/services/database_conversion_service";

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: any;
let devtools: any;
let db = new Database();
let tray: Tray;
let heartbeat: Heartbeat;
let autoLauncher: AutoLaunch;
let timerQuestion: any;

let iconUrl: string;
let pauseIconUrl: string;

let timelineService = new Timeline();
timelineService.registerEvents();
let dailyPieChartService = new DailyPieChart();
let processesService = new Processes();
let autoUpdaterService = new AutoUpdater();
let processGraph = new ProcessGraph();

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: {secure: true, standard: true}}]);

// process.env.TMPDIR = `$XDG_RUNTIME_DIR`;


let menuItems = [
    {
        label: 'Show/Hide',
        click() {
            if (win && win.isVisible()) {
                win.hide();
            } else {
                if (win === null) {
                    createWindow();
                }
                else{
                    win.show();
                }

            }
        }
    },
    {},
    {
        type: 'separator'
    },
    {
        label: "Check for updates",
        click() {
            autoUpdaterService.check();
        }
    },
    {
        label: 'Quit',
        click() {
            // @ts-ignore
            app.close = true;
            log.info("Closing app from quit");
            app.quit();
        }
    },
];

const pauseMenu = {
    label: 'Pause tracking',
    submenu: [
        {
            label: "For 10 minutes",
            click() {
                heartbeat.pause(10 * 60, resume);
                switchMenu(menuItems, resumeMenu);
                tray.setImage(pauseIconUrl);
            }
        },
        {
            label: "For 30 minutes",
            click() {
                heartbeat.pause(30 * 60, resume);
                switchMenu(menuItems, resumeMenu);
                tray.setImage(pauseIconUrl);
            }
        },
        {
            label: "For 1 hour",
            click() {
                heartbeat.pause(60 * 60, resume);
                switchMenu(menuItems, resumeMenu);
                tray.setImage(pauseIconUrl);
            }
        },
        {
            label: "Until I turn it back on",
            click() {
                heartbeat.pause(null, resume);
                switchMenu(menuItems, resumeMenu);
                tray.setImage(pauseIconUrl);
            }
        }
    ]
};

const resumeMenu = {
    label: "Resume tracking",
    click() {
        heartbeat.resume(resume);
    }
};

function focusWazzup(){
    win.show();
    win.focus();
    win.webContents.focus();
    win.webContents.send('wazzup', 'whoooooooh!')
}

async function createWindow() {
    log.info(`App version: ${app.getVersion()}`);

    // Create the browser window.
    let autostartOptions: any = {
        name: "timechart",
        hidden: true
    };

    await db.connect();
    await db.update();

    await Settings.init();
    await Entryinputs.init();
    await Customers.init();
    await Projects.init();

    // TODO: remove these hacks after electron-updater fixes appimage
    if (process.env.DESKTOPINTEGRATION === 'AppImageLauncher') {
        autostartOptions['path'] = process.env.ARGV0;
        process.env.APPIMAGE = process.env.ARGV0
    }

    autoUpdaterService.check();

    scheduleJob("0 14 * * *", autoUpdaterService.check);

    autoLauncher = new AutoLaunch(autostartOptions);

    if (process.env.WEBPACK_DEV_SERVER_URL) {
        // @ts-ignore
        iconUrl = path.join(__static, 'icon_development.png');
    } else {
        let iconFileName;

        if (process.platform === 'win32') {
            iconFileName = "32x32.png";
        } else if (process.platform === 'darwin') {
            iconFileName = "16x16.png";
        } else {
            iconFileName = "64x64.png"
        }

        // @ts-ignore
        iconUrl = path.join(__static, iconFileName);
    }

    let pauseIconFileName;
    if (process.platform === 'win32') {
        pauseIconFileName = "32x32_pause.png";
    } else if (process.platform === 'darwin') {
        pauseIconFileName = "16x16_pause.png";
    } else {
        pauseIconFileName = "64x64_pause.png";
    }

    // @ts-ignore
    pauseIconUrl = path.join(__static, pauseIconFileName);

    log.info(`iconUrl: ${iconUrl}`);

    win = new BrowserWindow({
        width: 800, height: 600, resizable: true, webPreferences: {
            nodeIntegration: true
        },
        fullscreen: false,
        show: !process.env.WEBPACK_DEV_SERVER_URL,
        icon: iconUrl
    });

    focusWazzup();


    if (!isDevelopment) {
        //win.setMenuBarVisibility(false);

        // TODO: Make production logging level configurable
        log.transports.file.level = 'info';
        log.transports.console.level = false;

        if (process.platform === 'darwin') {
            app.dock.hide();
        }
    } else {
        // No file logging for development
        log.transports.file.level = false;
    }

    heartbeat = new Heartbeat(win);
    heartbeat.start();

    if (process.env.WEBPACK_DEV_SERVER_URL) {
        // Load the url of the dev server if in development mode
        devtools = new BrowserWindow()
        win.webContents.setDevToolsWebContents(devtools.webContents)
        win.webContents.openDevTools({ mode: 'detach' })

        win.loadURL(process.env.WEBPACK_DEV_SERVER_URL);
        win.showInactive();
        // if (!process.env.IS_TEST) win.webContents.openDevTools();
    } else {
        createProtocol('app');
        // Load the index.html when not in development
        devtools = new BrowserWindow()
        win.webContents.setDevToolsWebContents(devtools.webContents)
        win.webContents.openDevTools({ mode: 'detach' })

        win.loadURL('app://./index.html');
    }

    ipcMain.on('get-version', async (event: any, arg: any) => {
        event.returnValue = app.getVersion();
    });

    ipcMain.on('hide-main', async (event: any) => {
        hideWindowUntillNextQuestion();
    });

    ipcMain.on('autostart-isenabled', async (event: any, arg: any) => {
        event.returnValue = await autoLauncher.isEnabled();
    });

    ipcMain.on('autostart-toggle', async (event: any) => {
        if (await autoLauncher.isEnabled()) {
            await autoLauncher.disable();
            log.info("Autostart disabled");
            event.returnValue = false;
        } else {
            await autoLauncher.enable();
            log.info("Autostart enabled");
            event.returnValue = true;
        }
    });

    ipcMain.on('is-development', (event: any) => {
        event.returnValue = isDevelopment;
    });

    ipcMain.on('convert', () => {
        let converter = new DatabaseConversionService();
        converter.convert();
    });

    tray = new Tray(iconUrl); // TODO: Tray icon is still broken with snap

    tray.setToolTip('Trajno');
    switchMenu(menuItems, pauseMenu);

    win.on('close', (event: Event) => {
        if (!isDevelopment) { // Overcome vue development hotreloading not closing window
            // @ts-ignore
            if (!app.close) { // TODO: get from settings
                log.info("Hiding window");
                win.hide();
                return event.preventDefault();
            }
        }
        log.info("Closing window");
        heartbeat.running = false;
    });

    win.on('closed', () => {
        win = null;
    });
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', async () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    log.info(`act1`);
    if (win === null) {
        await createWindow();
    }
});

const lock = app.requestSingleInstanceLock();

if (!lock && !isDevelopment) {
    app.quit()
} else {
    // @ts-ignore
    app.on('second-instance', (event: Event, commandLine: string, workingDirectory: string) => {
        if (win && !isDevelopment) {
            if (win.isMinimized()) {
                win.restore();
            }

            focusWazzup();
        }
    });

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.on('ready', async () => {
        if (isDevelopment && !process.env.IS_TEST) {
            // Install Vue Devtools

            try {
                //await installVueDevtools()
                //
                //
                console.log("skip devtools");
            } catch (e) {
                log.error('Vue Devtools failed to install:', e.toString())
            }
        }
        createMainMenu();
        log.info(`act2`);
        await createWindow();
    });
}

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
    if (process.platform === 'win32') {
        process.on('message', data => {
            if (data === 'graceful-exit') {
                app.quit();
            }
        })
    } else {
        process.on('SIGTERM', () => {
            app.quit()
        })
    }
}

function switchMenu(menuItems: any, menu: any) {
    menuItems[1] = menu;
    tray.setContextMenu(Menu.buildFromTemplate(menuItems));
}

function resume() {
    log.info("Resumed tracking");
    switchMenu(menuItems, pauseMenu);
    tray.setImage(iconUrl);
}

async function hideWindowUntillNextQuestion(){
//    let minutes = 0.1;
    let minutes:number = await Settings.getIntSetting('questionIntervalMinutes');
    //log.debug(minutes);

    win.hide();

    tray.setImage(iconUrl);

    clearTimeout(timerQuestion);
    timerQuestion = setTimeout(function(){
        showWindowForNextQuestion();
    }, (1000 * 60 * minutes));
}

function showWindowForNextQuestion(){
    tray.setImage(pauseIconUrl);
    focusWazzup();
}

async function exportTotalsForExact(){

    let options = {
        title: "Export for Exact Online",

        buttonLabel : "Export",
        defaultPath: '~/Desktop/export-totals.csv',

        filters :[
            {name: 'All Files', extensions: ['*']}
        ]
    }

    let filename = await dialog.showSaveDialog(win, options)
    if(!filename.canceled){
        let fpath = filename.filePath;
        if(fpath != undefined){
            //log.debug(await Entryinputs.interpret_day_totals_screen());
            Exporter.writeEntryDayTotalsToCSV(fpath, await Entryinputs.interpret_day_totals_exact());
        }
    }
}

function createMainMenu(){

    const isMac:boolean = process.platform === 'darwin'

    const template:Electron.MenuItemConstructorOptions[] = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Export totals for Exact',
                    click: () => {
                        exportTotalsForExact();
                    }
                },
                {
                    label: 'Flush all entries',
                    click: async () => {
                        Entryinputs.flushEntries();
                    }
                },
                {
                    label: 'Quit',
                    click() {
                        // @ts-ignore
                        app.close = true;
                        log.info("Closing app from quit");
                        app.quit();
                    }
                }
            ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                {
                    label: 'Learn More',
                    click: async () => {
                        const { shell } = require('electron')
                        await shell.openExternal('https://github.com/passing-train/trajno')
                    }
                }
            ]
        }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}

