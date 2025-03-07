// GNOME Extension: Whisper Transcriber (Minimal Version)
// Description: Records audio, transcribes it using OpenAI Whisper API, and copies to clipboard

const { St, GObject, GLib, Gio } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ByteArray = imports.byteArray;
const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Extension state
let indicator = null;
let isRecording = false;
let recordingPath = '';
let recordingProcess = null;
let settings = null;

// API key settings key
const API_KEY_SETTING = 'whisper-api-key';

const WhisperTranscriberIndicator = GObject.registerClass(
    class WhisperTranscriberIndicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, 'Whisper Transcriber');
            
            // Create the panel icon
            this.icon = new St.Icon({
                icon_name: 'audio-input-microphone-symbolic',
                style_class: 'system-status-icon'
            });
            this.add_child(this.icon);
            
            // Create the menu
            this._buildMenu();
        }
        
        _buildMenu() {
            // Record button
            this.recordItem = new PopupMenu.PopupMenuItem('Record Audio');
            this.recordItem.connect('activate', () => {
                if (isRecording) {
                    this._stopRecording();
                } else {
                    this._startRecording();
                }
            });
            this.menu.addMenuItem(this.recordItem);
            
            // Separator
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            
            // Settings
            const settingsItem = new PopupMenu.PopupMenuItem('Settings');
            settingsItem.connect('activate', () => {
                this._openSettings();
            });
            this.menu.addMenuItem(settingsItem);
        }

        _notify(message) {
            Main.notify('Whisper Transcriber', message);
        }
        
        _openSettings() {
            ExtensionUtils.openPrefs();
        }
        
        _startRecording() {
            if (isRecording) return;
            
            // Check API key
            const apiKey = settings.get_string(API_KEY_SETTING);
            if (!apiKey) {
                this._notify('Please set your OpenAI API key in the extension settings');
                this._openSettings();
                return;
            }
            
            // Simple path in /tmp
            recordingPath = '/tmp/whisper_recording_' + Math.floor(Date.now() / 1000) + '.ogg';
            
            // Update UI
            this.icon.icon_name = 'media-record-symbolic';
            this.icon.style = 'color: red;';
            this.recordItem.label.text = 'Stop Recording';
            isRecording = true;
            
            // Start ffmpeg process directly
            try {
                const ffmpegArgs = [
                    'ffmpeg',
                    '-f', 'alsa',
                    '-i', 'default',
                    '-c:a', 'libvorbis',
                    '-y',  // Overwrite output file if it exists
                    recordingPath     // Output file
                ];
                
                // Spawn the process with a unique identifier for easier killing
                this._logDebug('Recording...');
                const [success, pid] = GLib.spawn_async(
                    null,           // Working directory (null = default)
                    ffmpegArgs,     // Arguments
                    null,           // Environment variables (null = inherit)
                    GLib.SpawnFlags.SEARCH_PATH,  // Use PATH to find executable
                    null            // Child setup function
                );
                
                recordingProcess = pid;
            } catch (e) {
                this._notify('Error starting recording: ' + e.message);
                this._resetUI();
            }
        }
        
        _stopRecording() {
            if (!isRecording) return;
            
            // Kill the recording process more precisely
            try {
                // Use a more specific pkill command to target our ffmpeg instance
                // This pattern matches ffmpeg processes writing to our specific output file
                const killPattern = 'ffmpeg.*' + recordingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const killArgs = ['pkill', '-f', killPattern];
                
                // Fallback to more general ffmpeg kill if the specific kill fails
                try {
                    GLib.spawn_sync(null, killArgs, null, GLib.SpawnFlags.SEARCH_PATH, null);
                } catch (e) {
                    // If the specific kill fails, try a more general approach
                    GLib.spawn_sync(null, ['pkill', 'ffmpeg'], null, GLib.SpawnFlags.SEARCH_PATH, null);
                }
                
                this._logDebug('Processing recording...');
            } catch (e) {
                this._notify('Error stopping recording: ' + e.message);
            }
            
            // Reset UI
            this._resetUI();
            
            // Process the audio
            this._processAudio(recordingPath);
        }
        
        _resetUI() {
            this.icon.icon_name = 'audio-input-microphone-symbolic';
            this.icon.style = '';
            this.recordItem.label.text = 'Record Audio';
            isRecording = false;
        }
        
        _processAudio(filePath) {
            // Show processing indicator
            this.icon.icon_name = 'emblem-synchronizing-symbolic';
            this.recordItem.reactive = false;
            
            this._logDebug('Transcribing...');
            
            // Get API key from settings
            const apiKey = settings.get_string(API_KEY_SETTING);
            if (!apiKey) {
                this._notify('API key not set. Please configure in settings.');
                this._openSettings();
                this._resetProcessingUI();
                return;
            }
            
            // Direct curl command args
            const curlArgs = [
                'curl',
                '-s',
                'https://api.openai.com/v1/audio/transcriptions',
                '-H', 'Authorization: Bearer ' + apiKey,
                '-H', 'Content-Type: multipart/form-data',
                '-F', 'file=@' + filePath,
                '-F', 'model=whisper-1',
                '-F', 'response_format=text'
            ];
            
            // Run curl asynchronously to avoid UI freezing
            try {
                // Fall back to simpler approach if Gio subprocess fails
                try {
                    // Create a temp file for the output
                    const outputPath = '/tmp/whisper_output_' + Math.floor(Date.now() / 1000) + '.txt';
                    
                    // Build a command that writes to the output file
                    const command = 'curl -s "https://api.openai.com/v1/audio/transcriptions" ' +
                                   '-H "Authorization: Bearer ' + apiKey + '" ' +
                                   '-H "Content-Type: multipart/form-data" ' +
                                   '-F "file=@' + filePath + '" ' +
                                   '-F "model=whisper-1" ' +
                                   '-F "response_format=text" > ' + outputPath + ' 2>/tmp/whisper_error.txt';
                    
                    // Log command for debugging (without API key)
                    this._logDebug('Running command: ' + command.replace(apiKey, 'API_KEY_HIDDEN'));
                    
                    // Run the command asynchronously
                    const [success, pid] = GLib.spawn_async(
                        null,                         // Working directory
                        ['bash', '-c', command],      // Command
                        null,                         // Environment
                        GLib.SpawnFlags.SEARCH_PATH,  // Flags
                        null                          // Child setup function
                    );
                    
                    if (!success) {
                        throw new Error('Failed to launch transcription process');
                    }
                    
                    // Set up a timeout to check for the output file
                    this._checkTranscriptionResult(outputPath, filePath);
                    
                } catch (subprocessError) {
                    // Log the specific error
                    this._logDebug('Subprocess error: ' + subprocessError.message);
                    this._notify('Error with subprocess: ' + subprocessError.message.substring(0, 100));
                    throw subprocessError; // Re-throw for the outer catch
                }
            } catch (e) {
                this._notify('Error launching transcription: ' + e.message.substring(0, 100));
                this._resetProcessingUI();
                
                // Clean up file on error
                try {
                    GLib.unlink(filePath);
                } catch (e) {
                    // Ignore file cleanup errors
                }
            }
        }
        
        // Reset UI after processing
        _resetProcessingUI() {
            this.icon.icon_name = 'audio-input-microphone-symbolic';
            this.recordItem.reactive = true;
        }
        
        // Add debug logging method
        _logDebug(message) {
            log('[Whisper Transcriber] ' + message);
        }
        
        // Check for transcription results
        _checkTranscriptionResult(outputPath, originalFilePath) {
            // Check if the output file exists after a short delay
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                try {
                    // Check if file exists
                    if (GLib.file_test(outputPath, GLib.FileTest.EXISTS)) {
                        // Read the output file
                        let [success, contents] = GLib.file_get_contents(outputPath);
                        
                        if (success && contents && contents.length > 0) {
                            // Convert contents to string
                            const transcription = ByteArray.toString(contents).trim();
                            
                            if (transcription.length > 0) {
                                // Copy to clipboard
                                Clipboard.set_text(CLIPBOARD_TYPE, transcription);
                                
                                // Notify user
                                const truncated = transcription.length > 50 
                                    ? transcription.substring(0, 50) + '...' 
                                    : transcription;
                                this._notify('Transcription copied to clipboard: "' + truncated + '"');
                            } else {
                                this._notify('Transcription returned empty result');
                                
                                // Check for error output
                                this._checkErrorFile();
                            }
                            
                            // Clean up files
                            try {
                                GLib.unlink(outputPath);
                                GLib.unlink(originalFilePath);
                            } catch (e) {
                                // Ignore cleanup errors
                            }
                            
                            // Reset UI
                            this._resetProcessingUI();
                            return GLib.SOURCE_REMOVE; // Stop checking
                        }
                    }
                    
                    // If we reach here, either the file doesn't exist yet or it's empty
                    // Continue checking until timeout (20 seconds max)
                    this._checkCount = (this._checkCount || 0) + 1;
                    
                    if (this._checkCount > 40) { // 40 * 500ms = 20 seconds
                        this._notify('Transcription timed out');
                        this._checkErrorFile();
                        
                        // Clean up
                        try {
                            GLib.unlink(outputPath);
                            GLib.unlink(originalFilePath);
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                        
                        // Reset UI
                        this._resetProcessingUI();
                        return GLib.SOURCE_REMOVE; // Stop checking
                    }
                    
                    return GLib.SOURCE_CONTINUE; // Continue checking
                } catch (e) {
                    this._notify('Error checking results: ' + e.message.substring(0, 100));
                    this._resetProcessingUI();
                    return GLib.SOURCE_REMOVE; // Stop checking on error
                }
            });
        }
        
        // Check for error details
        _checkErrorFile() {
            try {
                if (GLib.file_test('/tmp/whisper_error.txt', GLib.FileTest.EXISTS)) {
                    let [success, contents] = GLib.file_get_contents('/tmp/whisper_error.txt');
                    if (success && contents && contents.length > 0) {
                        const errorMsg = ByteArray.toString(contents).trim();
                        this._notify('Error details: ' + errorMsg.substring(0, 100));
                        this._logDebug('Full error: ' + errorMsg);
                    }
                }
            } catch (e) {
                // Ignore errors reading the error file
            }
        }
    }
);

function init() {
    // Nothing to do here
}

function enable() {
    // Load settings
    settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.whisper-transcriber');
    
    // Create the indicator
    indicator = new WhisperTranscriberIndicator();
    
    // Add the indicator to the panel
    Main.panel.addToStatusArea('whisper-transcriber', indicator);
}

function disable() {
    // Stop any ongoing recording
    if (isRecording) {
        try {
            GLib.spawn_sync(null, ['pkill', 'ffmpeg'], null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            // Ignore errors during cleanup
        }
    }
    
    // Remove the indicator from the panel
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
    
    // Clean up settings
    settings = null;
}
