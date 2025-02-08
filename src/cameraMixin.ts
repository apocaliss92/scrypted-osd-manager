import sdk, { Setting, Settings, VideoTextOverlay, VideoTextOverlays } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import OsdManagerProvider from "./main";
import { getOverlayKeys, getOverlay, getOverlaySettings, pluginEnabledFilter, ListenersMap, OnUpdateOverlayFn, listenersIntevalFn, parseOverlayData, OverlayType } from "./utils";

export default class OsdManagerMixin extends SettingsMixinDeviceBase<any> implements Settings {
    killed: boolean;
    overlayIds: string[] = [];
    listenersMap: ListenersMap = {};
    checkInterval: NodeJS.Timeout;
    cameraDevice: VideoTextOverlays & Settings;

    storageSettings = new StorageSettings(this, {
        duplicateFromDevice: {
            title: 'Duplicate from device',
            description: 'Duplicate OSD information from another devices enabled on the plugin',
            type: 'device',
            deviceFilter: pluginEnabledFilter,
            immediate: true,
        },
    });

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: OsdManagerProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
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

    async getMixinSettings(): Promise<Setting[]> {
        const settings = await this.storageSettings.getSettings();

        settings.push(...getOverlaySettings({ storage: this.storageSettings, overlayIds: this.overlayIds }));

        return settings;
    }

    async putMixinSetting(key: string, value: string) {
        if (key === 'duplicateFromDevice') {
            await this.duplicateFromDevice(value);
        } else {
            this.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
    }

    async getOverlayData() {
        try {
            const textOverlays = await this.cameraDevice.getVideoTextOverlays();
            this.overlayIds = Object.entries(textOverlays).filter(([_, { readonly }]) => !readonly).map(([id]) => id);
        } catch (e) {
            this.console.error('Error inr getOverlayData', e);
        }
    }

    async duplicateFromDevice(deviceId: string) {
        try {
            const deviceToDuplicate = sdk.systemManager.getDeviceById<VideoTextOverlays & Settings>(deviceId);

            if (deviceToDuplicate) {
                const deviceSettings = await deviceToDuplicate.getSettings();
                const textOverlaysToDuplicate = await deviceToDuplicate.getVideoTextOverlays();

                for (const [overlayId, data] of Object.entries(textOverlaysToDuplicate)) {
                    if (!this.overlayIds.includes(overlayId)) {
                        continue;
                    }

                    const { device, type, regex, maxDecimals } = getOverlay({ overlayId, settings: deviceSettings });
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

    private updateOverlayData: OnUpdateOverlayFn = async (props) => {
        const { overlayId, listenerType, data, device, noLog } = props;
        if (!noLog) {
            this.console.log(`Update received from device ${device?.name} ${JSON.stringify({
                overlayId,
                listenerType,
                data
            })}`);
        }

        try {
            const settings = await this.getSettings();
            const overlay = getOverlay({ overlayId, settings });
            const textToUpdate = parseOverlayData({ data, listenerType, overlay, plugin: this.plugin });

            if (textToUpdate) {
                await this.cameraDevice.setVideoTextOverlay(overlayId, { text: textToUpdate });
            } else if (overlay.type === OverlayType.Disabled) {
                // await this.cameraDevice.setVideoTextOverlay(overlayId, { text: '' });
                await this.cameraDevice.setVideoTextOverlay(overlayId, { text: false });
            }
        } catch (e) {
            this.console.error('Error in updateOverlayData', e);
        }
    }

    async init() {
        this.cameraDevice = sdk.systemManager.getDeviceById<VideoTextOverlays & Settings>(this.id);

        try {
            const funct = async () => {
                try {
                    listenersIntevalFn({
                        console: this.console,
                        currentListeners: this.listenersMap,
                        id: this.id,
                        onUpdateFn: this.updateOverlayData,
                        overlayIds: this.overlayIds,
                        settings: await this.getSettings(),
                        plugin: this.plugin
                    });
                    await this.getOverlayData();
                } catch (e) {
                    this.console.error('Error in init interval', e);
                }

            };

            this.checkInterval = setInterval(funct, 10 * 1000);
            await funct();
        } catch (e) {
            this.console.error('Error in init', e);
        }
    }
}