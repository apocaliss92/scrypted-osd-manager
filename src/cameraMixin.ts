import sdk, { Battery, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Setting, Settings, SettingValue, Sleep, VideoTextOverlays } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import OsdManagerProvider from "./main";
import { CameraOverlay, convertSettingsToStorageSettings, getOverlay, getOverlayKeys, getOverlaySettings, ListenersMap, ListenerType, osdManagerPrefix, OverlayType, parseOverlayData, pluginEnabledFilter } from "./utils";

export type CameraType = ScryptedDeviceBase & VideoTextOverlays & Settings & Sleep & Battery;

export default class OsdManagerMixin extends SettingsMixinDeviceBase<any> implements Settings {
    initStorage: StorageSettingsDict<string> = {
        duplicateFromDevice: {
            title: 'Duplicate from device',
            description: 'Duplicate OSD information from another devices enabled on the plugin',
            type: 'device',
            deviceFilter: pluginEnabledFilter,
            immediate: true,
            onPut: async (_, value) => await this.duplicateFromDevice(value)
        },
    };
    storageSettings = new StorageSettings(this, this.initStorage);

    killed: boolean;
    overlays: CameraOverlay[] = [];
    listenersMap: ListenersMap = {};
    checkInterval: NodeJS.Timeout;
    cameraDevice: CameraType;

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: OsdManagerProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        this.cameraDevice = sdk.systemManager.getDeviceById<CameraType>(this.id);
        setTimeout(async () => !this.killed && await this.init(), 2000);
    }

    removeListeners() {
        try {
            Object.values(this.listenersMap).forEach(({ listener }) => listener && listener.removeListener());
            this.checkInterval && clearInterval(this.checkInterval);
            this.checkInterval = undefined;
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
            device: this.cameraDevice,
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
                    if (!this.overlays.some(overlay => overlayId === overlay.id)) {
                        continue;
                    }

                    const { device, type, regex, maxDecimals } = getOverlay({
                        overlayId,
                        storageSettings: this.plugin.mixinsMap[deviceId].storageSettings
                    });
                    const { deviceKey, typeKey, regexKey, maxDecimalsKey } = getOverlayKeys(overlayId);

                    await this.putMixinSetting(deviceKey, device);
                    await this.putMixinSetting(typeKey, type);
                    await this.putMixinSetting(regexKey, regex);
                    await this.putMixinSetting(maxDecimalsKey, String(maxDecimals));
                }
            }
        } catch (e) {
            this.console.error(`Error in duplicateFromDevice`, e);
        }
    }

    private updateOverlayData = async (props: {
        overlayId: string,
        listenerType: ListenerType,
        listenInterface?: ScryptedInterface,
        data: any,
    }) => {
        const { overlayId, listenerType, data } = props;
        if (this.cameraDevice.sleeping) {
            return;
        }

        this.console.log(`Setting overlay data ${overlayId}: ${JSON.stringify({
            listenerType,
            data
        })}`);

        try {
            const overlay = getOverlay({ overlayId, storageSettings: this.storageSettings });
            const textToUpdate = parseOverlayData({ data, listenerType, overlay, plugin: this.plugin });

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
            let listenInterface: ScryptedInterface;
            let deviceId: string;

            if (overlayType === OverlayType.Device) {
                const realDevice = sdk.systemManager.getDeviceById(overlay.device);
                if (realDevice) {
                    if (realDevice.interfaces.includes(ScryptedInterface.Thermometer)) {
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
                listenInterface = ScryptedInterface.ObjectDetection;
                deviceId = this.id;
            } else if (overlayType === OverlayType.BatteryLeft) {
                listenerType = ListenerType.Battery;
                listenInterface = ScryptedInterface.Battery;
                deviceId = this.id;
            }

            this.console.log(`Settings for overlay ${overlayId}: ${JSON.stringify({ overlayId, overlayType, listenerType, listenInterface, deviceId })}`);
            this.listenersMap[overlayId]?.listener && this.listenersMap[overlayId].listener.removeListener();
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

                    if (listenInterface === ScryptedInterface.Thermometer) {
                        update(realDevice.temperature);
                    } else if (listenInterface === ScryptedInterface.HumiditySensor) {
                        update(realDevice.humidity);
                    } else if (listenInterface === ScryptedInterface.Lock) {
                        update(realDevice.lockState);
                    } else if (listenInterface === ScryptedInterface.EntrySensor) {
                        update(realDevice.entryOpen);
                    } else if (listenInterface === ScryptedInterface.Battery) {
                        update(realDevice.batteryLevel);
                    } else if (listenInterface === ScryptedInterface.ObjectDetection) {
                        update({ detections: [{ className: 'face', label: '-' }] } as ObjectsDetected);
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
            }
        }
    }

    // async startInterval() {
    //     const funct = async () => {
    //         try {
    //             listenersIntevalFn({
    //                 console: this.console,
    //                 currentListeners: this.listenersMap,
    //                 id: this.id,
    //                 onUpdateFn: this.updateOverlayData,
    //                 overlays: this.overlays,
    //                 settings: await this.storageSettings.getSettings(),
    //                 plugin: this.plugin
    //             });
    //         } catch (e) {
    //             this.console.error('Error in init interval', e);
    //         }

    //     };

    //     await funct();
    //     this.checkInterval = setInterval(funct, 10 * 1000);
    // }

    async init() {
        try {
            await this.refreshSettings();
            await this.start();
        } catch (e) {
            this.console.error('Error in init', e);
        }
    }
}