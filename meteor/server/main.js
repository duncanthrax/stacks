import { Meteor } from 'meteor/meteor';
import { EJSON } from 'meteor/ejson';

var fs = require('fs');
var path = require('path');
var temp = require('temp');
var child_process = require('child_process');

var {msleep} = require('usleep');

RegExp.quote = function(str) {
	return (str+'').replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
};

// Default paths on Linux
var rarBin = '/usr/bin/unrar';
var zipBin = '/usr/bin/unzip';
var convertBin = '/usr/bin/convert';

if (process.platform === 'win32') {
	rarBin = Assets.absoluteFilePath('windows/unrar.exe');
	zipBin = Assets.absoluteFilePath('windows/unzip.exe');
	convertBin = Assets.absoluteFilePath('windows/convert.exe');
}

Books = new Mongo.Collection('books');
Thumbs = new Mongo.Collection('thumbs');
Misc = new Mongo.Collection('misc');

UnpackPaths = {};
NukeLibraryRequested = false;

Logger = function(ctx, msg, obj) {
	if (obj) console.log(`[${ctx}]`, msg, obj);
	else     console.log(`[${ctx}]`, msg);
};

ExecFileSync = Meteor.wrapAsync(function(cmd, opts, cb) {
	child_process.execFile(cmd, opts, function(error, stdout, stderr) {
		cb(error ? error.code : null, stdout.replace(new RegExp(/\s+/, 'g'), ' '));
	});
});

UnpackSync = function(library, book) {
	var tmpDir = temp.mkdirSync('stacks-tmp-book-' + book._id);

	// Alway try both rar/zip but start with the more likely one.
	if (book.type == 'cbr') {
		try {
			ExecFileSync(rarBin, ['e', '-o+', '-y', '-p-', '-inul', library + path.sep + book.dir + path.sep + book.file, tmpDir]);
		} catch (code) {
			Logger(book.name, rarBin + " returned exit code " + code + ", trying ZIP");
			try {
				ExecFileSync(zipBin, ['-o', '-j', '-qq', library + path.sep + book.dir + path.sep + book.file, '-d', tmpDir]);
			}
			catch(e) {
				Logger(book.name, zipBin + " returned exit code " + code);
			};
		}
	}
	else if (book.type == 'cbz') {
		try {
			ExecFileSync(zipBin, ['-o', '-j', '-qq', library + path.sep + book.dir + path.sep + book.file, '-d', tmpDir]);
		} catch (code) {
			Logger(book.name, zipBin + " returned exit code " + code + ", trying RAR");
			try {
				ExecFileSync(rarBin, ['e', '-o+', '-y', '-p-', '-inul', library + path.sep + book.dir + path.sep + book.file, tmpDir]);
			}
			catch(e) {
				Logger(book.name, rarBin + " returned exit code " + code);
			};
		}
	}

	return tmpDir;
};

Router.route('page', {
	name: 'page',
	path: /page\/(.+?)\/(.+?)$/,
	where: 'server',
	action: function() {

		var fourOfour = () => {
			this.response.writeHead(404);
			this.response.end('404 not found');
			return true;
		};

		var readPage = (unpackPath, page) => {
			var data = null;
			try {
				data = fs.readFileSync(unpackPath + path.sep + page.file)
			}
			catch (e) {
				Logger("readPage", "Exception while reading page file", e);
				return null;
			};
			return data;
		};

		var settings = Misc.findOne({ name: 'settings' });

		var pageNum = parseInt(this.params[1]);
		if (pageNum == NaN) return fourOfour();

		var book = Books.findOne({ _id: this.params[0] });
		if (!book) return fourOfour();

		var page = book.pages[pageNum];
		if (!page) return fourOfour();

		var data = null;
		if (UnpackPaths[book._id]) data = readPage(UnpackPaths[book._id], page);
		if (data) {
			Logger(book.name, "Download request for page " + pageNum + ", already unpacked");
		}
		else {
			Logger(book.name, "Download request for page " + pageNum + ", unpacking");
			UnpackPaths[book._id] = UnpackSync(settings.library, book);
			Logger(book.name, "Unpacked at " + UnpackPaths[book._id]);
			data = readPage(UnpackPaths[book._id], page);
		}

		if (!data) {
			Logger(book.name, "Unable to read image data for page " + pageNum);
			return fourOfour();
		}

		fs.unlinkSync(UnpackPaths[book._id] + path.sep + page.file);

		this.response.writeHead(200, { 'Content-Type': 'image' });
		this.response.write(data);
		this.response.end();
	}
});

ScannerProcess = false;
Watchers = {};
StartScanLib = function() {

	if (ScannerProcess) return;

	// Spawn scanner process
	ScannerProcess = child_process.fork(Assets.absoluteFilePath('ScanLib.js'));

	Misc.update({ name: 'status' }, { $set : { scannerStatus : 'active' } });

	ScannerProcess.on('exit', Meteor.bindEnvironment((code) => {
		Logger("StartScanLib", `Scanner exited with code ${code}`);
		Misc.update({ name: 'status' }, { $set : { scannerStatus : false } });
		ScannerProcess = false;
	}));

	ScannerProcess.on('message', Meteor.bindEnvironment((msg) => {
		if (msg.type == 'dirs') {
			var dirs = msg.dirs;
			var status   = Misc.findOne({name:'status'});
			var settings = Misc.findOne({name:'settings'});

			if (settings.library != status.scannerRunOnLibrary) return;

			// Delete old watchers
			Object.keys(Watchers).forEach(directory => {
				if (Watchers[directory]) Watchers[directory].close();
				Watchers[directory] = null; delete Watchers[directory];
			});

			// Set up new watchers
			var watchListenerTimeout = false;
			var watchListener = function(type, filename) {
				if (watchListenerTimeout) Meteor.clearTimeout(watchListenerTimeout);
				Logger("state", "Watch event, (re-)scheduling library scan in 5 seconds");
				watchListenerTimeout = Meteor.setTimeout(StartScanLib, 5000);
			};

			Logger("state", "Watching " + dirs.length + " directories");
			dirs.forEach( dir => {
				if (!Watchers[settings.library + path.sep + dir]) {
					Watchers[settings.library + path.sep + dir] = fs.watch(settings.library + path.sep + dir, {}, Meteor.bindEnvironment((type,filename) => { watchListener(type, filename) }));
				}
			});
		}
	}));

	ScannerProcess.send({
		type: 'start',
		cfg: {
			rarBin: rarBin,
			zipBin: zipBin,
			convertBin: convertBin,
			nukeLib: NukeLibraryRequested
		}
	});
	NukeLibraryRequested = false;
};

Meteor.startup(() => {
	Logger("startup", "Stacks server starting");

	Misc.update({ name:'settings' }, { $set : { fullRescan : false } });
	Misc.update({ name:'status' }, { $set : { scannerStatus : false } });

	Meteor.publish('books', function() { return Books.find() });
	Meteor.publish('misc', function() { return Misc.find() });

	var settings = Misc.findOne({name:'settings'});
	if (!settings) {
		// Default settings
		Logger("startup", "Creating default settings");
		Misc.insert({
			name            : 'settings',
			library         : process.env['STACKS_LIBRARY'] || '',
			initialStatus   : 'read',
			subsequentStatus: 'unread',
			unreadMatch     : '',
			fullRescan      : false
		});
	};
	var status = Misc.findOne({name:'status'});
	if (!status) {
		Logger("startup", "Creating default status");
		Misc.insert({
			name               : 'status',
			scannerStatus      : false,
			scannerRunOnLibrary: false
		});
	};

	Misc.find({ name: 'settings' }).observeChanges({
		changed(id, fields) {

			if (fields.library) {
				// Library location changed
				Logger("state", "Library location changed to " + fields.library);
			}
			if (fields.fullRescan) {
				// Full rescan requested
				Misc.update({ name:'settings' }, { $set : { fullRescan : false } });
				Misc.update({ name:'status' }, { $set : { scannerRunOnLibrary : false } });
				Logger("state", "Full library rescan requested");
				NukeLibraryRequested = true;
			}

			if (NukeLibraryRequested || fields.library) StartScanLib();
		}
	});

	// Startup scan
	StartScanLib();

	// Run a scan every hour
	Meteor.setInterval(StartScanLib, (1000 * 60 * 60));

	Meteor.methods({
		getThumb: function(bookId) {
			var thumb = Thumbs.findOne({_id : bookId});
			return thumb ? thumb.base64 : '';
		},

		getIcon: function(iconId) {
			var icon = Assets.getText('icomoon/' + iconId + '.svg');
			return icon ? icon : '';
		},

		setSettings: function(settings) {
			if (settings.library) settings.library = settings.library.replace(path.sep + '+$', '');

			if (!settings.library) delete settings['library'];
			Misc.update({ name:'settings' }, { $set : settings });
		},

		bookAction: function(action, bookId) {
			var book = Books.findOne({ _id: bookId });
			if (!book) return '';
			switch (action) {
				case 'markRead':
					Logger("state", "Marking '" + book.name + "' read");
					Books.update({ _id: bookId }, { $set : { isRead: true } });
				break;
				case 'markUnread':
					Logger("state", "Marking '" + book.name + "' unread");
					Books.update({ _id: bookId }, { $set : { isRead: false, activePage: 0 } });
				break;
				case 'markMassRead':
					Logger("state", "Marking " + book.stackId + " read up to order " + book.order);
					Books.update({ stackId: book.stackId, order: { $lte: book.order } }, { $set : { isRead : true } },{multi:true});
				break;
				case 'markMassUnread':
					Logger("state", "Marking " + book.stackId + " unread from order " + book.order);
					Books.update({ stackId: book.stackId, order: { $gte: book.order } }, { $set : { isRead : false, activePage: 0 } },{multi:true});
				break;
			}
		}
	});
});
