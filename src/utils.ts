import sdk, { EventListenerRegister, HumiditySensor, Lock, LockState, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Setting, Thermometer, VideoTextOverlay } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import OsdManagerProvider from "./main";

export const deviceFilter = `['${ScryptedInterface.Thermometer}','${ScryptedInterface.HumiditySensor}','${ScryptedInterface.Lock}'].some(elem => interfaces.includes(elem))`;
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
}

export type ListenersMap = Record<string, { listenerType: ListenerType, listener: EventListenerRegister, device?: string }>;

export type OnUpdateOverlayFn = (props: {
    overlayId: string,
    listenerType: ListenerType,
    listenInterface?: ScryptedInterface,
    data: any,
    device?: ScryptedDeviceBase,
    noLog?: boolean,
    plugin: OsdManagerProvider
}) => Promise<void>

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
    overlays: CameraOverlay[]
}) => {
    const { storage, overlays } = props;
    const settings: Setting[] = [];

    for (const overlay of overlays) {
        const overlayId = overlay.id;
        const overlayName = `Overlay ${overlayId}`;

        const { currentTextKey, deviceKey, typeKey, regexKey, textKey, maxDecimalsKey } = getOverlayKeys(overlayId);

        settings.push(
            {
                key: currentTextKey,
                title: 'Current content',
                type: 'string',
                subgroup: overlayName,
                value: overlay.text,
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
                title: 'Overlay type',
                type: 'string',
                choices: Object.values(OverlayType),
                subgroup: overlayName,
                value: type,
                immediate: true,
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
                value: storage.getItem(textKey),
            })
        };

        const regexSetting: Setting = {
            key: regexKey,
            title: 'Value regex',
            description: 'Expression to generate the text. ${value} contains the value and ${unit} the unit',
            type: 'string',
            subgroup: overlayName,
            placeholder: '${value} ${unit}',
            value: storage.getItem(regexKey) || '${value} ${unit}',
        };
        const precisionSetting: Setting = {
            key: maxDecimalsKey,
            title: 'Max decimals',
            type: 'number',
            subgroup: overlayName,
            value: storage.getItem(maxDecimalsKey) ?? 1
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
                    value: storage.getItem(deviceKey)
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
    settings: Setting[],
    overlayId: string
}): Overlay => {
    const { settings, overlayId } = props;
    const settingsByKey = settings.reduce((tot, curr) => ({
        ...tot,
        [curr.key]: curr
    }), {});

    const { currentTextKey, deviceKey, typeKey, regexKey, textKey, maxDecimalsKey } = getOverlayKeys(overlayId);

    const currentText = settingsByKey[`${osdManagerPrefix}:${currentTextKey}`]?.value;
    const type = settingsByKey[`${osdManagerPrefix}:${typeKey}`]?.value ?? OverlayType.Text;
    const device = settingsByKey[`${osdManagerPrefix}:${deviceKey}`]?.value;
    const text = settingsByKey[`${osdManagerPrefix}:${textKey}`]?.value;
    const regex = settingsByKey[`${osdManagerPrefix}:${regexKey}`]?.value;
    const maxDecimals = settingsByKey[`${osdManagerPrefix}:${maxDecimalsKey}`]?.value;

    return {
        currentText,
        device,
        type,
        regex,
        text,
        maxDecimals
    };
}

export const listenersIntevalFn = (props: {
    overlays: CameraOverlay[],
    settings: Setting[],
    console: Console,
    id: string,
    currentListeners: ListenersMap,
    onUpdateFn: OnUpdateOverlayFn,
    plugin: OsdManagerProvider
}) => {
    const { overlays, settings, console, id, currentListeners, onUpdateFn, plugin } = props;

    for (const cameraOverlay of overlays) {
        const overlayId = cameraOverlay.id;
        const overlay = getOverlay({
            overlayId,
            settings
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
                }
            } else {
                console.log(`Device ${overlay.device} not found`);
            }
        } else if (overlayType === OverlayType.FaceDetection) {
            listenerType = ListenerType.Face;
            listenInterface = ScryptedInterface.ObjectDetection;
            deviceId = id;
        } else if (overlayType === OverlayType.BatteryLeft) {
            listenerType = ListenerType.Battery;
            listenInterface = ScryptedInterface.Battery;
            deviceId = id;
        }

        const currentListener = currentListeners[overlayId];
        const currentDevice = currentListener?.device;
        const differentType = (!currentListener || currentListener.listenerType !== listenerType);
        const differentDevice = overlay.type === OverlayType.Device ? currentDevice !== overlay.device : false;
        if (listenerType) {
            if (listenInterface && deviceId && (differentType || differentDevice)) {
                const realDevice = sdk.systemManager.getDeviceById<ScryptedDeviceBase>(deviceId);
                console.log(`Overlay ${overlayId}: starting device ${realDevice.name} listener for type ${listenerType} on interface ${listenInterface}`);
                currentListener?.listener && currentListener.listener.removeListener();
                const update = async (data: any) => await onUpdateFn({
                    listenInterface,
                    overlayId,
                    data,
                    listenerType,
                    device: realDevice,
                    plugin
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
                } else if (listenInterface === ScryptedInterface.Battery) {
                    update(realDevice.batteryLevel);
                } else if (listenInterface === ScryptedInterface.ObjectDetection) {
                    update({ detections: [{ className: 'face', label: '-' }] } as ObjectsDetected);
                }

                currentListeners[overlayId] = {
                    listenerType,
                    device: overlay.device,
                    listener: newListener
                };
            }
        } else if (overlayType === OverlayType.Text) {
            currentListener?.listener && currentListener.listener.removeListener();
            onUpdateFn({
                overlayId,
                listenerType,
                data: overlay.text,
                noLog: true,
                plugin
            });
        } else if (overlayType === OverlayType.Disabled) {
            currentListener?.listener && currentListener.listener.removeListener();
            onUpdateFn({
                overlayId,
                listenerType,
                data: '',
                noLog: true,
                plugin
            });
        }
    }
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

    let value;
    let unit;
    let textToUpdate = text;
    if (listenerType === ListenerType.Face) {
        value = (data as ObjectsDetected)?.detections?.find(det => det.className === 'face')?.label;
    } else if (listenerType === ListenerType.Temperature) {
        value = Number(data ?? 0)?.toFixed(maxDecimals);
        unit = realDevice.temperatureUnit;
    } else if (listenerType === ListenerType.Humidity) {
        value = Number(data ?? 0)?.toFixed(maxDecimals);
        unit = '%';
    } else if (listenerType === ListenerType.Battery) {
        value = Number(data ?? 0)?.toFixed(maxDecimals);
        unit = '%';
    } else if (listenerType === ListenerType.Lock) {
        textToUpdate = data === LockState.Locked ? plugin.storageSettings.values.lockText : plugin.storageSettings.values.lockText;
    }

    if (value) {
        textToUpdate = regex
            .replace('${value}', value || '')
            .replace('${unit}', unit || '');
    }

    return textToUpdate;
}