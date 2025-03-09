import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PrefsWidget = GObject.registerClass(
    class PrefsWidget extends Adw.PreferencesPage {
        _init(settings) {
            super._init();
            
            this._settings = settings;
            
            // Create API Key group
            const apiGroup = new Adw.PreferencesGroup({
                title: _('OpenAI API Settings')
            });
            this.add(apiGroup);
            
            // Create API Key row
            const apiKeyRow = new Adw.EntryRow({
                title: _('API Key'),
                tooltip_text: _('Enter your OpenAI API key here')
            });
            
            // Set current value
            apiKeyRow.text = this._settings.get_string('whisper-api-key');
            
            // Connect to change event
            apiKeyRow.connect('changed', (entry) => {
                this._settings.set_string('whisper-api-key', entry.text);
            });
            
            apiGroup.add(apiKeyRow);
            
            // Add helper text
            const helpGroup = new Adw.PreferencesGroup();
            this.add(helpGroup);
            
            const helpLabel = new Gtk.Label({
                label: _('Get your API key from <a href="https://platform.openai.com/account/api-keys">OpenAI</a>'),
                use_markup: true,
                margin_top: 10
            });
            helpLabel.connect('activate-link', (label, uri) => {
                Gtk.show_uri(null, uri, Gtk.get_current_event_time());
                return true;
            });
            
            helpGroup.add(helpLabel);
        }
    }
);

export default class WhisperTranscriberPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        
        const page = new PrefsWidget(settings);
        window.add(page);
    }
}
