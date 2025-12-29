# My CT Protocol

This hanging protocol automatically applies a 2x2 grid layout for CT studies.

## Features

- **Automatic matching**: Automatically matches CT studies (Modality = CT)
- **2x2 Grid Layout**: Displays CT images in a 2x2 grid layout
- **High Priority**: Has a very high matching weight (10000) to ensure it's selected for CT studies

## Usage

### Automatic Application
The protocol will automatically apply when a CT study is loaded, as long as:
1. The study contains CT images
2. The protocol is registered (happens automatically at app startup)

### Manual Application via URL
You can also manually select this protocol by adding this to your URL:
```
&hangingProtocolId=myCtProtocol
```

### Verification
To verify the protocol is registered and working:

1. **Check Browser Console**: Look for the log message:
   ```
   ✅ Registered custom hanging protocol: myCtProtocol with ID: myCtProtocol
   ```

2. **Check Protocol Matching**: When a CT study loads, check the console for:
   ```
   ProtocolEngine::findMatchByStudy matched [...]
   ```
   You should see `myCtProtocol` in the matched protocols list with a high score.

3. **Verify Layout**: After loading a CT study, you should see a 2x2 grid layout instead of the default layout.

## Troubleshooting

If the protocol is not applying:

1. **Reload the study**: If you already had a study loaded before the protocol was registered, reload the study or refresh the page.

2. **Check registration**: Open browser console and verify you see the registration log message.

3. **Manual selection**: Try manually selecting it via URL parameter: `&hangingProtocolId=myCtProtocol`

4. **Check for errors**: Look for any errors in the browser console that might indicate why the protocol isn't matching.
