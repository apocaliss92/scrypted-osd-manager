import sdk, { Battery, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Sensors, Setting, Settings, SettingValue, Sleep, TemperatureUnit, VideoTextOverlays } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import OsdManagerProvider from "./main";
import { CameraOverlay, convertSettingsToStorageSettings, formatValue, getOverlay, getOverlayKeys, getOverlaySettings, getTemplateKeys, getEntryText, getLockText, ListenersMap, ListenerType, osdManagerPrefix, Overlay, OverlayType, parseOverlayData, pluginEnabledFilter, getStrippedNativeId } from "./utils";
import { Unit, UnitConverter } from "../../scrypted-homeassistant/src/unitConverter";

export type CameraType = ScryptedDeviceBase & VideoTextOverlays & Settings & Sleep & Battery;

export default class OsdManagerMixin extends SettingsMixinDeviceBase<any> implements Settings {
    initStorage: StorageSettingsDict<string> = {
        lastFace: {
            type: 'string',
            hide: true,
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
    listenersMap: ListenersMap = {};
    cameraDevice: CameraType;

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: OsdManagerProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        this.cameraDevice = sdk.systemManager.getDeviceById<CameraType>(this.id);
        setTimeout(async () => !this.killed && await this.init(), 2000);
    }

    removeListeners() {
        try {
            Object.values(this.listenersMap).forEach(({ listener, interval }) => {
                listener && listener.removeListener();
                interval && clearInterval(interval);
            });
        } catch (e) {
            this.console.error('Error in removeListeners', e);
        }
    }

    async release() {
        this.killed = true;
        this.removeListeners();
    }

    async refreshSettings() {
        this.console.log('Refreshing settings');
        await this.getOverlayData();

        const dynamicSettings = getOverlaySettings({
            storage: this.storageSettings,
            overlays: this.overlays,
            logger: this.console,
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
            this.console.error('Error inr getOverlayData', e);
        }
    }

    async duplicateFromDevice(deviceId: string) {
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

                    const { device, type, regex, maxDecimals, sensorId, sensorName, unit, text, template, updateFrequency } = getOverlay({
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
                        updateFrequencyKey,
                        textKey
                    } = getOverlayKeys(overlayId);

                    await this.putMixinSetting(deviceKey, device);
                    await this.putMixinSetting(typeKey, type);
                    await this.putMixinSetting(regexKey, regex);
                    await this.putMixinSetting(sensorIdKey, sensorId);
                    await this.putMixinSetting(sensorNameKey, sensorName);
                    await this.putMixinSetting(unitKey, unit);
                    await this.putMixinSetting(templateKey, template);
                    await this.putMixinSetting(updateFrequencyKey, String(updateFrequency));
                    await this.putMixinSetting(textKey, text);
                    await this.putMixinSetting(maxDecimalsKey, String(maxDecimals));
                }

                await this.putMixinSetting('duplicateFromDevice', undefined);
                await this.refreshSettings();
            }
        } catch (e) {
            this.console.error(`Error in duplicateFromDevice`, e);
        }
    }

    private async updateOverlayDataFromTemplate(props: {
        overlayId: string,
        template: string,
    }) {
        const { overlayId, template } = props;
        const { devicesKey, parserStringKey } = getTemplateKeys(template);
        const deviceIds = JSON.parse(this.plugin.storage.getItem(devicesKey) ?? '[]');
        let parserString = this.plugin.storage.getItem(parserStringKey) || '';
    
        try {
            for (const deviceId of deviceIds) {
                const device = sdk.systemManager.getDeviceById(deviceId);
                if (!device) {
                    this.console.warn(`Device ${deviceId} not found.`);
                    continue;
                }
                parserString = await this.applyDeviceTemplate(parserString, device, template);
            }
        } catch (e) {
            this.console.error('Error parsing template', e);
        }
    
        this.console.log(`Updating overlay ${overlayId} with ${parserString}`);
        await this.cameraDevice.setVideoTextOverlay(overlayId, { text: parserString });
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
            }
            else if (device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
                const sensorKeys = getSensorKeys('humidity');
                maxDecimals = this.plugin.storageSettings.getItem(sensorKeys.maxDecimalsKey) ?? 1;
                value = device.humidity;
                unit = '%';
            }
            else if (device.interfaces.includes(ScryptedInterface.EntrySensor)) {
                value = getEntryText(device.entryOpen, this.plugin);
            }
            else if (device.interfaces.includes(ScryptedInterface.Lock)) {
                value = getLockText(device.lockState, this.plugin);
            }
            else if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
                value = device.binaryState ? 'On' : 'Off';
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
        const { overlayId, listenerType, data } = props;

        if (this.cameraDevice.sleeping) {
            return;
        }

        try {
            const overlay = getOverlay({ overlayId, storageSettings: this.storageSettings });
            const { textToUpdate, value } = parseOverlayData({ data, listenerType, overlay, plugin: this.plugin, logger: this.console });

            if (value == undefined && listenerType === ListenerType.Face) {
                return;
            }

            this.console.log(`Setting overlay data ${overlayId}: ${JSON.stringify({
                listenerType,
                data,
                textToUpdate
            })}`);

            if (listenerType === ListenerType.Face) {
                this.storageSettings.putSetting('lastFace', value);
            }

            if (textToUpdate) {
                await this.cameraDevice.setVideoTextOverlay(overlayId, { text: textToUpdate });
            } else if (overlay.type === OverlayType.Disabled) {
                await this.cameraDevice.setVideoTextOverlay(overlayId, { text: false });
            }
        } catch (e) {
            this.console.error('Error in updateOverlayData', e);
        }
    }

    async start() {
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
                    }
                } else {
                    this.console.log(`Device ${overlay.device} not found`);
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

            this.console.log(`Settings for overlay ${overlayId}: ${JSON.stringify({ overlay, overlayType, listenerType, listenInterface, deviceId })}`);
            this.listenersMap[overlayId]?.listener && this.listenersMap[overlayId].listener.removeListener();
            this.listenersMap[overlayId]?.interval && clearInterval(this.listenersMap[overlayId].interval);

            if (listenerType) {
                if (listenInterface && deviceId) {
                    const realDevice = sdk.systemManager.getDeviceById<ScryptedDeviceBase>(deviceId);
                    this.console.log(`Overlay ${overlayId}: starting device ${realDevice.name} listener for type ${listenerType} on interface ${listenInterface}`);
                    const update = async (data: any) => await this.updateOverlayData({
                        listenInterface,
                        overlayId,
                        data,
                        listenerType,
                    });
                    const newListener = realDevice.listen(listenInterface, async (_, __, data) => {
                        await update(data);
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
                    } else if (listenInterface === ScryptedInterface.Battery) {
                        update(realDevice.batteryLevel);
                    } else if (listenInterface === ScryptedInterface.ObjectDetector) {
                        update({ detections: [{ className: 'face', label: this.storageSettings.values.lastFace || '-' }] } as ObjectsDetected);
                    }

                    this.listenersMap[overlayId] = {
                        listenerType,
                        device: overlay.device,
                        listener: newListener
                    };
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
                this.console.log(`Overlay ${overlayId}: interval to update the template ${overlay.template}`);

                const newListener = setInterval(async () => {
                    await this.updateOverlayDataFromTemplate({ overlayId, template: overlay.template });
                }, overlay.updateFrequency * 1000)

                this.listenersMap[overlayId] = {
                    listenerType: ListenerType.Interval,
                    interval: newListener
                };
            }

            // if (this.cameraDevice.interfaces.includes(ScryptedInterface.Sleep)) {
            //     const realDevice = sdk.systemManager.getDeviceById<ScryptedDeviceBase>(this.id);
            //     this.listenersMap[ScryptedInterface.Sleep] = {
            //         listener: realDevice.listen(ScryptedInterface.Sleep, async (_, __, data) => {
            //             this.console.log('Camera woke up, updating ovelays', data);
            //         }),
            //         listenerType: ListenerType.Battery,
            //         device: this.id
            //     }
            // }
        }
    }

    async init() {
        try {
            await this.refreshSettings();
        } catch (e) {
            this.console.error('Error in init', e);
        }
    }
}