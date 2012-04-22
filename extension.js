/* -*- mode: js2 - indent-tabs-mode: nil - js2-basic-offset: 4 -*- */
/*
 * GNOME Shell extension that aims at integrating the Web/Epiphany
 * bookmarks into the shell.
 * Copyright (C) 2012  Andrea Santilli <andresantilli gmx com>
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301,
 * USA.
 */

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Search = imports.ui.search;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const BK_FILE_NAME = 'bookmarks.rdf';
const DEFAULT_BK_FILE = GLib.build_filenamev([
    GLib.get_home_dir(), '.gnome2', 'epiphany', BK_FILE_NAME
]);
const BK_LAUNCH = 'epiphany --new-tab "%s"';
const ERROR_SPAWN = "ERROR: could not run \"%s\"";
const ERROR_MODE = "%s: wrong mode";
const ERROR_GIO_FILE_TYPE = '%s: file must be a GIO local file.';
const MENU_ALIGNMENT        = 0.5;
const EXT_STATUS_AREA_ID    = 'web-bookmarks';
const ERROR_NOT_A_FILE = "ERROR: \"%s\" is not a regular file\n";
const ERROR_INVALID_XML = "ERROR: Invalid XML file %s.";
const TOOLBAR_TITLE = 'Bookmarks Toolbar';
const SEARCH_TITLE = "Web Bookmarks";
const ENTRY_NAME = 'epiphany.desktop';

/* these are bitmasks
 * other modes are yet to be implemented */
const ModeType = {
    MENU : 1,
    SEARCH : 2,
    OVERVIEW : 4
}

/* yup, I know... but monkey-patching the menu prototypes didn't prove
 * to be a reliable solution here */
function ab_insert(entry, menu) {
    let children = menu._getMenuItems();
    let is_submenu = (entry instanceof PopupMenu.PopupSubMenuMenuItem);

    if ((!children) || (children[0] == undefined)) {
        menu._submenus = menu._entries = 0;
        (is_submenu)?menu._submenus++:menu._entries++;
        menu.addMenuItem(entry);
        return;
    }

    let start = 0, end = this._submenus + this._entries - 1;
    /* otherwise, consider only the part we need to arrange */
    if (is_submenu) {
        if (!menu._submenus) {
            menu.addMenuItem(entry, 0);
            menu._submenus++;
            return;
        }
        start = 0;
        end = (!menu._submenus)?0:menu._submenus - 1;
    } else {
        if (!menu._entries) {
            menu.addMenuItem(entry, menu._submenus);
            menu._entries++;
            return;
        }
        start = menu._submenus;
        end = menu._submenus + menu._entries - 1;
    }

    /* case insensitive sorting */
    let cmp_text = entry.label.text.toLowerCase();

    if (cmp_text < children[start].label.text.toLowerCase()) {
        (is_submenu)?menu._submenus++:menu._entries++;
        menu.addMenuItem(entry, start);
        return;
    }

    if (cmp_text > children[end].label.text.toLowerCase()) {
        (is_submenu)?menu._submenus++:menu._entries++;
        menu.addMenuItem(entry, end + 1);
        return;
    }

    let mid = start;
    while ((start < end) && (end - start > 1)) {
        /* fetch the entry in the middle */
        mid = Math.floor((start + end) / 2);

        if (cmp_text < children[mid].label.text.toLowerCase()) {
            end = mid;
        } else {
            start = mid;
        }
    }

    /* at this point we have a subarray containing 2 elements */
    mid = start;
    if (cmp_text > children[mid].label.text.toLowerCase()) {
        mid++;
    }
    (is_submenu)?menu._submenus++:menu._entries++;
    menu.addMenuItem(entry, mid);
}

function EphyBookmarkSearchProvider() {
    this._init.apply(this, arguments);
}

EphyBookmarkSearchProvider.prototype = {
    __proto__: Search.SearchProvider.prototype,

    _init: function() {
        Search.SearchProvider.prototype._init.call(this, SEARCH_TITLE);
    },

    set_data: function(entries) {
        this.data = entries;
    },

    getResultMeta: function(id) {
        let app_sys = Shell.AppSystem.get_default();
        let app = app_sys.lookup_heuristic_basename(ENTRY_NAME);

        return {
            'id'            :   id,
            'name'          :   this.data[id.pos].name,
            'createIcon'    :   function (size) {
                return app.create_icon_texture(size);
            }
        };
    },

    getResultMetas: function(ids) {
        let app_sys = Shell.AppSystem.get_default();
        let app = app_sys.lookup_heuristic_basename(ENTRY_NAME);
        let metas = new Array();

        for each(let id in ids) {
            metas.push({
                'id'            :   id,
                'name'          :   this.data[id.pos].name,
                'createIcon'    :   function (size) {
                    return app.create_icon_texture(size);
                }
            });
        }
        return metas;
    },

    activateResult: function(id) {
        let command = BK_LAUNCH.format(id.url);
        if (!GLib.spawn_command_line_async(command, null)) {
            global.log(_(ERROR_SPAWN).format(command));
        }
    },

    getInitialResultSet: function(terms) {
        let results = [];

        if ((this.data == undefined) || (this.data == null)) {
            return results;
        }

        for each (let item in this.data) {
            let words = (item.name + item.url).replace(/\s/g, '');
            let pattern = '';
            for (let j in terms) {
                if (terms[j] != '') {
                    pattern += terms[j];
                }
            }
            regexp = new RegExp(pattern, 'gi');

            if (words.match(regexp)) {
                results.push(item);
            }
        }

        return results;
    },

    getSubsearchResultSet: function(prev_res, terms) {
        return this.getInitialResultSet(terms);
    },

    destroy: function() {
        this.data = undefined;
        this.emit('destroy');
    }
};

function EphyBookmarkMenuItem() {
    this._init.apply(this, arguments);
}

EphyBookmarkMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(title, url, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        this.url = url;
        this.label = new St.Label({ text: title });
        this.addActor(this.label);

        this.connect('activate', Lang.bind(this, function() {
            let command = BK_LAUNCH.format(this.url);
            if (!GLib.spawn_command_line_async(command, null)) {
                global.log(_(ERROR_SPAWN).format(command));
            }
        }));
    }
};

function EphyBookmarksMenu() {
    this._init.apply(this, arguments);
}

EphyBookmarksMenu.prototype = {
    __proto__: PanelMenu.Button.prototype,

    _init: function(params)
    {
        PanelMenu.Button.prototype._init.call(this, MENU_ALIGNMENT);

        this._icon = new St.Icon({ icon_name: 'starred',
                                   icon_type: St.IconType.SYMBOLIC,
                                   style_class: 'system-status-icon' });
        this.actor.add_actor(this._icon);

        Main.panel.addToStatusArea(EXT_STATUS_AREA_ID, this);
    },

    destroy: function()
    {
        this.actor._delegate = null;
        this.menu.destroy();
        this.actor.destroy();
        this.emit('destroy');
    }
};

function EphyBookmarksManager() {
    this._init.apply(this, arguments);
}

EphyBookmarksManager.prototype = {
    _init: function(path, mode, params) {
        let data;

        this.mode = mode;
        this.file = Gio.file_new_for_path(path);

        if (!(mode & (ModeType.MENU | ModeType.SEARCH | ModeType.OVERVIEW))) {
            throw new Error(ERROR_MODE.format('_init()'));
        }

        if (this.mode & ModeType.MENU) {
            this.panelmenu = new EphyBookmarksMenu();
        }

        /* this always returns json data of a given structure */
        this._buildup();
        try {
            this.monitor = this.file.monitor_file(
                Gio.FileMonitorFlags.NONE, null, null);
        } catch (e) {
            global.log(e.message);
        }

        if (this.monitor) {
            let file = this.file;
            let monitor = this.monitor;
            this.monitor.connect('changed', Lang.bind(this,
                function(monitor, file, other_file, event_type, data) {
                    this._buildup();
                }
            ));
        }

        return true;
    },

    _buildup: function() {
        let search_entries;

        /* remove all the existing entries first */
        this.panelmenu.menu.removeAll();

        let data = this._parse_ephy_rdf(this.file); 

        if (this.mode & ModeType.SEARCH) {
            if ((this.search_provider != undefined) &&
                    (this.search_provider != null)) {
                Main.overview.removeSearchProvider(this.search_provider);
                this.search_provider.destroy();
            }
            this.search_provider = new EphyBookmarkSearchProvider();
            search_entries = new Array();
        }

        for (let i in data.children) {
            let submenu;
            
            if (this.mode & ModeType.MENU) {
                submenu = new PopupMenu.PopupSubMenuMenuItem(i);
            }

            for each (let item in data.children[i]) {
                if (this.mode & ModeType.MENU) {
                    ab_insert(
                        new EphyBookmarkMenuItem(item.title, item.link),
                        submenu.menu
                    );
                }

                if (this.mode & ModeType.SEARCH) {
                    search_entries.push({
                        'pos'   :   search_entries.length,
                        'name'  :   item.title,
                        'url'   :   item.link
                    });
                }
            }

            if (this.mode & ModeType.MENU) {
                ab_insert(submenu, this.panelmenu.menu);
            }
        }

        for each (let item in data.contents) {
            let entry = new EphyBookmarkMenuItem(
                item.title, item.link);
            ab_insert(entry, this.panelmenu.menu);
        }

        if (this.mode & ModeType.SEARCH) {
            this.search_provider.set_data(search_entries);
            Main.overview.addSearchProvider(this.search_provider);
        }
    },

    _parse_ephy_rdf: function() {
        let entries = { 'children' : {}, 'contents' : [] };
        let res, contents, length, etag;
        let raw;
        let rdf;

        if (this.file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) !=
                Gio.FileType.REGULAR) {
            global.log(ERROR_NOT_A_FILE.format(this.file.get_path()));
            return entries;
        }
        
        try {
            [res, contents, length, etag] = this.file.load_contents(null);
        } catch (e) {
            print(e.message);
            return entries;
        }
        
        /* remove the xml header, see https://developer.mozilla.org/en/E4X */
        /* FIXME: you might still get a "regular expression is too complex"
         * error by applying the same regex to some xml files. I should
         * inspect whether it is safe just to let it manipulate the epiphany's
         * bookmark rdf or, alternatively, find another solution (GRegex?). */
        try {
            raw = contents.toString().replace(
                /^<\?xml\s+version\s*=\s*(["'])[^\1]+\1[^?]*\?>/, '');
        } catch(e) {
            global.log(ERROR_INVALID_XML.format(this.file.get_path()));
            return entries;
        }

        rdf = new XML(raw);
        
        /* X4E queries here, note they never throw errors */
        for each(let element in rdf.*::item) {
            let in_sub = false;
            for each(let subject in element.*::subject) {
                if (subject == TOOLBAR_TITLE) {
                    continue;
                }
                in_sub = true;
                
                if (entries['children'][subject.toString()] == undefined) {
                    entries['children'][subject.toString()] = new Array();
                }
                entries['children'][subject.toString()].push({
                    'title' : (element.*::title).toString(),
                    'link'  : (element.*::link).toString()
                });
            }
            
            if (!in_sub) {
                entries['contents'].push({
                    'title' : (element.*::title).toString(),
                    'link'  : (element.*::link).toString()
                });
            }
        }
        return entries;
    },

    destroy: function() {
        if (this.monitor) {
            this.monitor.cancel();
        }
        this.file = null;
        if (this.panelmenu != undefined) {
            this.panelmenu.destroy();
        }

        if (this.search_provider != undefined) {
            Main.overview.removeSearchProvider(this.search_provider);
            this.search_provider.destroy();
        }
    }
};

let manager;

function init(metadata) {}

function enable() {
    let mode = ModeType.MENU | ModeType.SEARCH;

    manager = new EphyBookmarksManager(DEFAULT_BK_FILE, mode);
}

function disable() {
    manager.destroy();
}

