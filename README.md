# Scrypted OSD Manager

The `OSD Manager` plugin for Scrypted provides advanced overlay management for your devices. It allows you to display dynamic information such as temperature, humidity, lock state, face detection status, and battery level directly on your camera streams. 

## Usage

1. **Installation & Setup**
   - Install the `OSD Manager` plugin in Scrypted.
   - Ensure your camera supports video text overlays by enabling them through the camera's web interface or app.
   - Enable the `OSD Manager` plugin on the camera's extensions in Scrypted.

2. **Overlay Management**
   - Access the device settings where the plugin is enabled.
   - Add or modify overlays by selecting the appropriate type:
     - **Text**: For static overlay messages.
     - **Device**: To pull dynamic data from sensor devices (e.g., Thermometer, Humidity Sensor, Lock). One device per overlay is supported.
     - **Face Detection**: To display the name of the last detected face (if enabled).
     - **Battery Left**: To show the remaining battery percentage of the device (if supported).

4. **Duplicating Data**
   - Use the "Duplicate from device" option to mirror OSD settings from another compatible device.