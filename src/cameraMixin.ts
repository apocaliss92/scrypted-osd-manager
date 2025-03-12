import sdk, { Battery, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Sensors, Setting, Settings, SettingValue, Sleep, TemperatureUnit, VideoTextOverlays } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import { Unit, UnitConverter } from "../../scrypted-homeassistant/src/unitConverter";
import OsdManagerProvider from "./main";
import { CameraOverlay, convertSettingsToStorageSettings, formatValue, getBinaryText, getEntryText, getLockText, getOverlay, getOverlayKeys, getOverlaySettings, getStrippedNativeId, getTemplateKeys, ListenerType, osdManagerPrefix, OverlayType, parseOverlayData, pluginEnabledFilter } from "./utils";

export type CameraType = ScryptedDeviceBase & VideoTextOverlays & Settings & Sleep & Battery;

export default class OsdManagerMixin extends SettingsMixinDeviceBase<any> implements Settings {
    initStorage: StorageSettingsDict<string> = {
        lastFace: {
            type: 'string',
            hide: true,
        },
        refreshDataInterval: {
            title: 'Refresh frequency in seconds',
            description: 'Define how often the layers should refresh',
            type: 'number',
            defaultValue: 5,
            onPut: async () => await this.refreshSettings()
        },
        enableDebug: {
            title: 'Enable debug',
            type: 'boolean',
            immediate: true,
        },
        duplicateFromDevice: {
            title: 'Duplicate from device',
            description: 'Duplicate OSD information from another devices enabled on the plugin',
            type: 'device',
            deviceFilter: pluginEnabledFilter,
            immediate: true,
            onPut: async (_, value) => await this.duplicateFromDevice(value)
        },
        refreshOverlays: {
            title: 'Get data from camera',
            type: 'button',
            onPut: async () => await this.refreshSettings()
        },
    };
    storageSettings = new StorageSettings(this, this.initStorage);

    killed: boolean;
    overlays: CameraOverlay[] = [];
    refreshInterval: NodeJS.Timeout;
    cameraDevice: CameraType;
    logger: Console;
    settingsLogged: Record<string, boolean> = {};

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: OsdManagerProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        this.cameraDevice = sdk.systemManager.getDeviceById<CameraType>(this.id);
        setTimeout(async () => !this.killed && await this.init(), 2000);
    }

    removeListeners() {
        const logger = this.getLogger();
        try {
            this.refreshInterval && clearInterval(this.refreshInterval);
            this.settingsLogged = {};
        } catch (e) {
            logger.error('Error in removeListeners', e);
        }
    }

    async release() {
        this.killed = true;
        this.removeListeners();
    }

    public getLogger() {
        const deviceConsole = this.console;

        if (!this.logger) {
            const log = (debug: boolean, message?: any, ...optionalParams: any[]) => {
                const now = new Date().toLocaleString();
                if (!debug || this.storageSettings.values.enableDebug) {
                    deviceConsole.log(` ${now} - `, message, ...optionalParams);
                }
            };
            this.logger = {
                log: (message?: any, ...optionalParams: any[]) => log(false, message, ...optionalParams),
                error: (message?: any, ...optionalParams: any[]) => log(false, message, ...optionalParams),
                debug: (message?: any, ...optionalParams: any[]) => log(true, message, ...optionalParams),
            } as Console
        }

        return this.logger;
    }

    async refreshSettings() {
        const logger = this.getLogger();
        logger.log('Refreshing settings');
        await this.getOverlayData();

        const dynamicSettings = getOverlaySettings({
            storage: this.storageSettings,
            overlays: this.overlays,
            logger,
            device: this.cameraDevice,
            templates: this.plugin.storageSettings.values.templates,
            onSettingUpdated: this.refreshSettings
        });

        this.storageSettings = await convertSettingsToStorageSettings({
            device: this,
            dynamicSettings,
            initStorage: this.initStorage
        });

        this.removeListeners();
        this.start();
    }

    async getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        const [group, ...rest] = key.split(':');
        if (group === osdManagerPrefix) {
            this.storageSettings.putSetting(rest.join(':'), value);
        } else {
            super.putSetting(key, value);
        }
    }

    async putMixinSetting(key: string, value: string) {
        this.storageSettings.putSetting(key, value);
    }

    async getOverlayData() {
        const logger = this.getLogger();
        try {
            if (this.cameraDevice.sleeping) {
                return;
            }

            const textOverlays = await this.cameraDevice.getVideoTextOverlays();
            this.overlays = Object.entries(textOverlays)
                .map(([id, overlay]) => {
                    return {
                        id,
                        ...overlay,
                    }
                });

            for (const overlay of this.overlays) {
                const { currentText } = getOverlay({ overlayId: overlay.id, storageSettings: this.storageSettings });
                const { currentTextKey } = getOverlayKeys(overlay.id);

                await this.putMixinSetting(currentTextKey, currentText);
            }
        } catch (e) {
            logger.error('Error inr getOverlayData', e);
        }
    }

    async duplicateFromDevice(deviceId: string) {
        const logger = this.getLogger();
        try {
            const deviceToDuplicate = sdk.systemManager.getDeviceById<VideoTextOverlays & Settings>(deviceId);

            if (deviceToDuplicate) {
                const textOverlaysToDuplicate = await deviceToDuplicate.getVideoTextOverlays();

                for (const [overlayId, data] of Object.entries(textOverlaysToDuplicate)) {
                    const canDuplicate = deviceToDuplicate.pluginId === this.cameraDevice.pluginId ||
                        this.overlays.some(overlay => overlayId === overlay.id);

                    if (!canDuplicate) {
                        continue;
                    }

                    const { device, type, regex, maxDecimals, sensorId, sensorName, unit, text, template, maxCharacters } = getOverlay({
                        overlayId,
                        storageSettings: this.plugin.mixinsMap[deviceId].storageSettings
                    });
                    const {
                        deviceKey,
                        typeKey,
                        regexKey,
                        maxDecimalsKey,
                        sensorIdKey,
                        sensorNameKey,
                        unitKey,
                        templateKey,
                        textKey,
                        maxCharactersKey
                    } = getOverlayKeys(overlayId);

                    await this.putMixinSetting(deviceKey, device);
                    await this.putMixinSetting(typeKey, type);
                    await this.putMixinSetting(regexKey, regex);
                    await this.putMixinSetting(sensorIdKey, sensorId);
                    await this.putMixinSetting(sensorNameKey, sensorName);
                    await this.putMixinSetting(unitKey, unit);
                    await this.putMixinSetting(templateKey, template);
                    await this.putMixinSetting(textKey, text);
                    await this.putMixinSetting(maxDecimalsKey, String(maxDecimals));
                    await this.putMixinSetting(maxCharactersKey, String(maxCharacters));
                }

                await this.putMixinSetting('duplicateFromDevice', undefined);
                await this.refreshSettings();
            }
        } catch (e) {
            logger.error(`Error in duplicateFromDevice`, e);
        }
    }

    private limitText(props: { overlayId: string, text: string }) {
        const { overlayId, text } = props;

        const overlay = getOverlay({ overlayId, storageSettings: this.storageSettings });
        const { maxCharacters } = overlay;

        if (!maxCharacters) {
            return text;
        } else {
            if (text.length <= maxCharacters) {
                return text;
            } else {
                return `${text.substring(0, maxCharacters - 3)}...`;
            }
        }
    }

    private updateOverlayDataFromTemplate = async (props: {
        overlayId: string,
        template: string,
    }) => {
        const logger = this.getLogger();
        const { overlayId, template } = props;
        const { devicesKey, parserStringKey, } = getTemplateKeys(template);
        const deviceIds = JSON.parse(this.plugin.storage.getItem(devicesKey) ?? '[]');
        let parserString = this.plugin.storage.getItem(parserStringKey) || '';

        try {
            for (const deviceId of deviceIds) {
                const device = sdk.systemManager.getDeviceById(deviceId);
                if (!device) {
                    logger.log(`Device ${deviceId} not found.`);
                    continue;
                }
                parserString = await this.applyDeviceTemplate(parserString, device, template);
            }
        } catch (e) {
            logger.log('Error parsing template', e);
        }

        logger.debug(`Updating overlay ${overlayId} with ${parserString}`);
        await this.cameraDevice.setVideoTextOverlay(overlayId, { text: this.limitText({ overlayId, text: parserString }) });
    }

    private async applyDeviceTemplate(
        templateString: string,
        device: any,
        template: string
    ): Promise<string> {
        const { getDeviceKeys, getSensorKeys } = getTemplateKeys(template);

        if (device.interfaces.includes(ScryptedInterface.Sensors)) {
            const { sensorsKey } = getDeviceKeys(device.id);
            const selectedSensorIds = JSON.parse(this.plugin.storage.getItem(sensorsKey) ?? '[]');
            for (const sensorId of selectedSensorIds) {
                const sensorData = device.sensors[sensorId];
                const { maxDecimalsKey, unitKey } = getSensorKeys(sensorId);
                const sensorUnit = this.plugin.storage.getItem(unitKey);
                const maxDecimals = this.plugin.storageSettings.getItem(maxDecimalsKey) ?? 1;
                const replaceString = `{${device.id}.${sensorId}}`;
                const unit = sensorUnit ?? sensorData?.unit;
                let value = sensorData?.value;
                if (typeof value === 'number') {
                    const localValue = UnitConverter.siToLocal(value, unit as Unit);
                    value = formatValue(localValue, maxDecimals);
                }
                templateString = templateString.replaceAll(replaceString, String(value));
            }
        }
        else {
            const strippedNativeId = getStrippedNativeId(device);
            const replaceString = `{${device.id}.${strippedNativeId}}`;
            let value: any;
            let unit: any;
            let maxDecimals = 1;

            if (device.interfaces.includes(ScryptedInterface.Thermometer)) {
                const sensorKeys = getSensorKeys('temperature');
                maxDecimals = this.plugin.storageSettings.getItem(sensorKeys.maxDecimalsKey) ?? 1;
                value = device.temperature;
                unit = device.temperatureUnit;
                if (unit === TemperatureUnit.F) {
                    value = value * 9 / 5 + 32;
                }
            } else if (device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
                const sensorKeys = getSensorKeys('humidity');
                maxDecimals = this.plugin.storageSettings.getItem(sensorKeys.maxDecimalsKey) ?? 1;
                value = device.humidity;
                unit = '%';
            } else if (device.interfaces.includes(ScryptedInterface.EntrySensor)) {
                value = getEntryText(device.entryOpen, this.plugin);
            } else if (device.interfaces.includes(ScryptedInterface.Lock)) {
                value = getLockText(device.lockState, this.plugin);
            } else if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
                value = getBinaryText(device.lockState, this.plugin);
            }

            if (typeof value === 'number') {
                const localValue = UnitConverter.siToLocal(value, unit);
                value = formatValue(localValue, maxDecimals);
            }
            templateString = templateString.replaceAll(replaceString, String(value));
        }

        return templateString;
    }

    private updateOverlayData = async (props: {
        overlayId: string,
        listenerType: ListenerType,
        listenInterface?: ScryptedInterface | string,
        data: any,
    }) => {
        const logger = this.getLogger();
        const { overlayId, listenerType, data } = props;

        if (this.cameraDevice.sleeping) {
            return;
        }

        try {
            const overlay = getOverlay({ overlayId, storageSettings: this.storageSettings });
            const { textToUpdate, value } = parseOverlayData({ data, listenerType, overlay, plugin: this.plugin, logger });

            if (value == undefined && listenerType === ListenerType.Face) {
                return;
            }

            logger.debug(`Setting overlay data ${overlayId}: ${JSON.stringify({
                listenerType,
                data,
                textToUpdate
            })}`);

            if (listenerType === ListenerType.Face) {
                this.storageSettings.putSetting('lastFace', value);
            }

            if (textToUpdate) {
                await this.cameraDevice.setVideoTextOverlay(overlayId, { text: this.limitText({ overlayId, text: textToUpdate }) });
            } else if (overlay.type === OverlayType.Disabled) {
                await this.cameraDevice.setVideoTextOverlay(overlayId, { text: false });
            }
        } catch (e) {
            logger.error('Error in updateOverlayData', e);
        }
    }

    async start() {
        const funct = async () => {
            const logger = this.getLogger();
            for (const cameraOverlay of this.overlays) {
                const overlayId = cameraOverlay.id;
                const overlay = getOverlay({
                    overlayId,
                    storageSettings: this.storageSettings
                });

                const overlayType = overlay.type;
                let listenerType: ListenerType;
                let listenInterface: ScryptedInterface | string;
                let deviceId: string;

                if (overlayType === OverlayType.Device) {
                    const realDevice = sdk.systemManager.getDeviceById<Sensors>(overlay.device);

                    if (realDevice) {
                        if (realDevice.interfaces.includes(ScryptedInterface.Sensors)) {
                            if (overlay.sensorName) {
                                const sensorId = overlay.sensorId ?? Object.entries(realDevice.sensors)
                                    .find(([_, { name }]) => name === overlay.sensorName)?.[0];

                                listenerType = ListenerType.Sensors;
                                listenInterface = sensorId;
                                deviceId = overlay.device;
                            }
                        } else if (realDevice.interfaces.includes(ScryptedInterface.Thermometer)) {
                            listenerType = ListenerType.Temperature;
                            listenInterface = ScryptedInterface.Thermometer;
                            deviceId = overlay.device;
                        } else if (realDevice.interfaces.includes(ScryptedInterface.HumiditySensor)) {
                            listenerType = ListenerType.Humidity;
                            listenInterface = ScryptedInterface.HumiditySensor;
                            deviceId = overlay.device;
                        } else if (realDevice.interfaces.includes(ScryptedInterface.Lock)) {
                            listenerType = ListenerType.Lock;
                            listenInterface = ScryptedInterface.Lock;
                            deviceId = overlay.device;
                        } else if (realDevice.interfaces.includes(ScryptedInterface.EntrySensor)) {
                            listenerType = ListenerType.Entry;
                            listenInterface = ScryptedInterface.EntrySensor;
                            deviceId = overlay.device;
                        } else if (realDevice.interfaces.includes(ScryptedInterface.BinarySensor)) {
                            listenerType = ListenerType.Binary;
                            listenInterface = ScryptedInterface.BinarySensor;
                            deviceId = overlay.device;
                        }
                    } else {
                        logger.log(`Device ${overlay.device} not found`);
                    }
                } else if (overlayType === OverlayType.FaceDetection) {
                    listenerType = ListenerType.Face;
                    listenInterface = ScryptedInterface.ObjectDetector;
                    deviceId = this.id;
                } else if (overlayType === OverlayType.BatteryLeft) {
                    listenerType = ListenerType.Battery;
                    listenInterface = ScryptedInterface.Battery;
                    deviceId = this.id;
                }

                if (!this.settingsLogged[overlayId]) {
                    logger.log(`Settings for overlay ${overlayId}: ${JSON.stringify({ overlay, overlayType, listenerType, listenInterface, deviceId })}`);
                    this.settingsLogged[overlayId] = true;
                }

                if (listenerType) {
                    if (listenInterface && deviceId) {
                        const realDevice = sdk.systemManager.getDeviceById<ScryptedDeviceBase>(deviceId);
                        const update = async (data: any) => await this.updateOverlayData({
                            listenInterface,
                            overlayId,
                            data,
                            listenerType,
                        });

                        if (listenerType === ListenerType.Sensors) {
                            update(realDevice.sensors?.[listenInterface]);
                        } else if (listenInterface === ScryptedInterface.Thermometer) {
                            update(realDevice.temperature);
                        } else if (listenInterface === ScryptedInterface.HumiditySensor) {
                            update(realDevice.humidity);
                        } else if (listenInterface === ScryptedInterface.Lock) {
                            update(realDevice.lockState);
                        } else if (listenInterface === ScryptedInterface.EntrySensor) {
                            update(realDevice.entryOpen);
                        } else if (listenInterface === ScryptedInterface.BinarySensor) {
                            update(realDevice.binaryState);
                        } else if (listenInterface === ScryptedInterface.Battery) {
                            update(realDevice.batteryLevel);
                        } else if (listenInterface === ScryptedInterface.ObjectDetector) {
                            update({ detections: [{ className: 'face', label: this.storageSettings.values.lastFace || '-' }] } as ObjectsDetected);
                        }
                    }
                } else if (overlayType === OverlayType.Text) {
                    this.updateOverlayData({
                        overlayId,
                        listenerType,
                        data: overlay.text,
                    });
                } else if (overlayType === OverlayType.Disabled) {
                    this.updateOverlayData({
                        overlayId,
                        listenerType,
                        data: '',
                    });
                } else if (overlayType === OverlayType.Template && overlay.template) {
                    await this.updateOverlayDataFromTemplate({ overlayId, template: overlay.template });
                }
            }
        }

        this.refreshInterval = setInterval(funct, this.storageSettings.values.refreshDataInterval * 1000);
    }

    async init() {
        const logger = this.getLogger();
        try {
            await this.refreshSettings();
        } catch (e) {
            logger.error('Error in init', e);
        }
    }
}