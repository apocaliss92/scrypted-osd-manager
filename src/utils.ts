import sdk, { EventListenerRegister, HumiditySensor, Lock, LockState, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Setting, TemperatureUnit, Thermometer, VideoTextOverlay } from "@scrypted/sdk";
import { StorageSetting, StorageSettings, StorageSettingsDevice, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import { CameraType } from "./cameraMixin";
import OsdManagerProvider from "./main";

export const deviceFilter = `['${ScryptedInterface.Thermometer}','${ScryptedInterface.HumiditySensor}','${ScryptedInterface.Lock}','${ScryptedInterface.EntrySensor}'].some(elem => interfaces.includes(elem))`;
export const pluginEnabledFilter = `interfaces.includes('${ScryptedInterface.VideoTextOverlays}')`;
export const osdManagerPrefix = 'osdManager';

export type CameraOverlay = VideoTextOverlay & { id: string };
export type SupportedDevice = ScryptedDeviceBase & (Thermometer | HumiditySensor | Lock);
export enum OverlayType {
    Disabled = 'Disabled',
    Text = 'Text',
    Device = 'Device',
    FaceDetection = 'FaceDetection',
    BatteryLeft = 'BatteryLeft',
}

interface Overlay {
    currentText: string;
    text: string;
    type: OverlayType;
    device: string;
    regex: string;
    maxDecimals: number;
}

export enum ListenerType {
    Face = 'Face',
    Humidity = 'Humidity',
    Temperature = 'Temperature',
    Lock = 'Lock',
    Battery = 'Battery',
    Entry = 'Entry',
}

export type ListenersMap = Record<string, { listenerType: ListenerType, listener: EventListenerRegister, device?: string }>;

export const getFriendlyTitle = (props: {
    rawTitle: string,
    device: ScryptedDeviceBase,
}) => {
    const { device, rawTitle } = props;
    if (device.pluginId === '@scrypted/amcrest') {
        return rawTitle
            .replace(/^table\.VideoWidget\[\d+\]\./, '');
    } else {
        return `Overlay ${rawTitle}`;
    }
}

export const getOverlayKeys = (overlayId: string) => {
    const currentTextKey = `overlay:${overlayId}:currentText`;
    const textKey = `overlay:${overlayId}:text`;
    const typeKey = `overlay:${overlayId}:type`;
    const regexKey = `overlay:${overlayId}:regex`;
    const deviceKey = `overlay:${overlayId}:device`;
    const maxDecimalsKey = `overlay:${overlayId}:maxDecimals`;

    return {
        currentTextKey,
        textKey,
        typeKey,
        regexKey,
        deviceKey,
        maxDecimalsKey,
    }
}

export const getOverlaySettings = (props: {
    storage: StorageSettings<any>,
    overlays: CameraOverlay[],
    device: CameraType,
    onSettingUpdated: () => Promise<void>
}) => {
    const { storage, overlays, device, onSettingUpdated } = props;
    const settings: StorageSetting[] = [];

    for (const overlay of overlays) {
        const rawTitle = `${overlay.id}`;
        const friendlyTitle = getFriendlyTitle({
            rawTitle,
            device,
        });
        const overlayName = friendlyTitle;

        const { currentTextKey, deviceKey, typeKey, regexKey, textKey, maxDecimalsKey } = getOverlayKeys(overlay.id);

        settings.push(
            {
                key: currentTextKey,
                title: 'Current Content',
                type: 'string',
                subgroup: overlayName,
                readonly: true,
            }
        )
        if (overlay.readonly) {
            settings.push(
                {
                    title: 'Readonly',
                    type: 'boolean',
                    subgroup: overlayName,
                    value: true,
                    readonly: true,
                }
            );

            continue;
        }
        const type = storage.getItem(typeKey) ?? OverlayType.Text;

        settings.push(
            {
                key: typeKey,
                title: 'Overlay Type',
                type: 'string',
                choices: Object.values(OverlayType),
                defaultValue: OverlayType.Text,
                subgroup: overlayName,
                immediate: true,
                onPut: onSettingUpdated
            }
        );

        if (type === OverlayType.Disabled) {
            continue;
        }

        if (type === OverlayType.Text) {
            settings.push({
                key: textKey,
                title: 'Text',
                type: 'string',
                subgroup: overlayName,
                onPut: onSettingUpdated
            })
        };

        const regexSetting: StorageSetting = {
            key: regexKey,
            title: 'Value Regex',
            description: 'Expression to generate the text. ${value} contains the value and ${unit} the unit',
            type: 'string',
            subgroup: overlayName,
            placeholder: '${value} ${unit}',
            defaultValue: '${value} ${unit}',
            onPut: onSettingUpdated
        };
        const precisionSetting: StorageSetting = {
            key: maxDecimalsKey,
            title: 'Max Decimals',
            type: 'number',
            subgroup: overlayName,
            defaultValue: 1,
            onPut: onSettingUpdated
        };

        if (type === OverlayType.Device) {
            settings.push(
                {
                    key: deviceKey,
                    title: 'Device',
                    type: 'device',
                    subgroup: overlayName,
                    deviceFilter,
                    immediate: true,
                    onPut: onSettingUpdated
                },
                regexSetting,
                precisionSetting,
            );
        } else if (type === OverlayType.FaceDetection) {
            settings.push(regexSetting);
        } else if (type === OverlayType.BatteryLeft) {
            settings.push(regexSetting, precisionSetting);
        }
    }

    return settings;
}

export const getOverlay = (props: {
    storageSettings: StorageSettings<string>,
    overlayId: string
}): Overlay => {
    const { storageSettings, overlayId } = props;

    const { currentTextKey, deviceKey, typeKey, regexKey, textKey, maxDecimalsKey } = getOverlayKeys(overlayId);

    const currentText = storageSettings.values[currentTextKey];
    const type = storageSettings.values[typeKey];
    const device = storageSettings.values[deviceKey]?.id;
    const text = storageSettings.values[textKey];
    const regex = storageSettings.values[regexKey];
    const maxDecimals = storageSettings.values[maxDecimalsKey];

    return {
        currentText,
        device,
        type,
        regex,
        text,
        maxDecimals
    };
}

export const parseOverlayData = (props: {
    listenerType: ListenerType,
    data: any,
    overlay: Overlay,
    plugin: OsdManagerProvider
}) => {
    const { listenerType, data, overlay, plugin } = props;
    const { regex, text, device, maxDecimals } = overlay;
    const realDevice = device ? sdk.systemManager.getDeviceById<SupportedDevice>(device) : undefined;

    const formatValue = (value: any) => {
        const factor = Math.pow(10, maxDecimals);
        return Math.round(Number(value ?? 0) * factor) / factor;
    };

    let value;
    let unit;
    let textToUpdate = text;
    if (listenerType === ListenerType.Face) {
        value = (data as ObjectsDetected)?.detections?.find(det => det.className === 'face')?.label;
    } else if (listenerType === ListenerType.Temperature) {
        unit = realDevice.temperatureUnit ?? TemperatureUnit.C;

        if (unit === TemperatureUnit.F) {
            value = value * 9 / 5 + 32
        }

        value = formatValue(data);
    } else if (listenerType === ListenerType.Humidity) {
        value = formatValue(data);
        unit = '%';
    } else if (listenerType === ListenerType.Battery) {
        value = formatValue(data);
        unit = '%';
    } else if (listenerType === ListenerType.Lock) {
        textToUpdate = data === LockState.Locked ? plugin.storageSettings.values.lockText : plugin.storageSettings.values.unlockText;
    } else if (listenerType === ListenerType.Entry) {
        textToUpdate = data ? plugin.storageSettings.values.closedText : plugin.storageSettings.values.openText;
    }


    if (value) {
        textToUpdate = regex
            .replace('${value}', value || '')
            .replace('${unit}', unit || '');
    }

    return textToUpdate;
}

export const convertSettingsToStorageSettings = async (props: {
    device: StorageSettingsDevice,
    dynamicSettings: StorageSetting[],
    initStorage: StorageSettingsDict<string>
}) => {
    const { device, dynamicSettings, initStorage } = props;

    const onPutToRestore: Record<string, any> = {};
    Object.entries(initStorage).forEach(([key, setting]) => {
        if (setting.onPut) {
            onPutToRestore[key] = setting.onPut;
        }
    });

    const settings: StorageSetting[] = await new StorageSettings(device, initStorage).getSettings();

    settings.push(...dynamicSettings);

    const deviceSettings: StorageSettingsDict<string> = {};

    for (const setting of settings) {
        const { value, key, onPut, ...rest } = setting;
        deviceSettings[key] = {
            ...rest
        };
        if (setting.onPut) {
            deviceSettings[key].onPut = setting.onPut.bind(device)
        }
    }

    const updateStorageSettings = new StorageSettings(device, deviceSettings);

    Object.entries(onPutToRestore).forEach(([key, onPut]) => {
        updateStorageSettings.settings[key].onPut = onPut;
    });

    return updateStorageSettings;
}