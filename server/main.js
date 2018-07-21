import { Meteor } from 'meteor/meteor';
import { Jobs } from 'meteor/msavin:sjobs';
import { EJSON } from 'meteor/ejson';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var temp = require('temp');
var sprintf = require('sprintf-js').sprintf;
var execFile = require('child_process').execFile;

var {msleep} = require('usleep');

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
Watchers = {};
LibrarySubDirs = [];

Logger = function(ctx, msg, obj) {
	if (obj) console.log("["+ctx+"]",msg,obj);
	else     console.log("["+ctx+"]",msg);
};

ReaddirSync = Meteor.wrapAsync(function(dir, cb) { fs.readdir(dir, cb) });
ExecFileSync = Meteor.wrapAsync(function(cmd, opts, cb) {
	execFile(cmd, opts, function(error, stdout, stderr) {
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


ScanDir = function(base, dir, books, dirs) {
	dir = dir || '';
	books = books || [];

	dir = dir.replace('^' + path.sep + '+', '').replace(path.sep + '+$', '');

	dirs.push(dir);

	ReaddirSync(base + path.sep + dir).forEach((file) => {
		var stats = fs.statSync(base + path.sep + dir + path.sep + file);
		if (stats && stats.isDirectory()) ScanDir(base, dir + path.sep + file, books, dirs);
		else {
			var m; m = file.match(new RegExp(/^(.+)\.(cbr|cbz)$/,'i'));
			if (!m) return;

			var name = m[1];
			var type = m[2].toLowerCase();

			name = name.
				// Treat dots as whitespace
				replace(new RegExp(/\./,'g'), ' ').
				// Remove trailing bracketed items
				replace(new RegExp(/\s*\(.+\)\s*$/,'g'), '').
				// Collapse whitespace
				replace(new RegExp(/\s+/,'g'), ' ');

			// <title> <order>
			var     m = name.match(new RegExp(/^(.+)\s+([0-9a-d#]+)$/,'i'));
			// <title> <order> - <book title>
			if (!m) m = name.match(new RegExp(/^(.+)\s+([0-9a-d#]+)\s+\-\s.+$/,'i'));
			// <title>
			if (!m) m = name.match(new RegExp(/^(.+)$/,'i'));

			if (!m) {
				Logger("scanDir", "Unable to parse filename '" + name + "'");
				return;
			}

			var stackName = m[1];
			var order = m[2] || '';
			order = order.replace(new RegExp(/\#/,'g'), '');

			var id = crypto.createHash('sha1').update(stats.mtime.toString()).update(name.toLowerCase().replace(new RegExp(/\s/,'g'), '')).digest('hex');
			var stackId = stackName.toLowerCase().replace(new RegExp(/[^a-z0-9]/,'g'), '');

			books.push({
					  _id: id,
					 name: name,
				  stackId: stackId,
				stackName: stackName,
				    order: order ? sprintf("#%05s", order) : 'Single',
				     type: type,
				      dir: dir,
				     file: file,
				     size: stats.size,
				    mtime: Math.floor(stats.mtimeMs),
				  missing: false
			});
		}
	});

	return books;
};

Router.route('page', {
	name: 'page',
	path: /^\/page\/(.+?)\/(.+?)$/,
	where: 'server',
	action: function() {

		var fourOfour = () => {
			this.response.writeHead(404);
			this.response.end('404 not found');
			return true;
		};

		var readPage = (path, page) => {
			var data = null;
			try {
				data = fs.readFileSync(path + path.sep + page.file)
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

ScanLibJobId = false;
PendingJobTimeout = false;
AbortScanLibJob = false;
NukeLibraryRequested = false;
StartScanLib = function() {

	if (PendingJobTimeout) return;

	if (ScanLibJobId) {
		Logger("scanLib", "Job already scheduled or running, aborting");
		AbortScanLibJob = true;

		var checkJob; checkJob = () => {
			if (!ScanLibJobId) {
				PendingJobTimeout = false;
				Meteor.setTimeout(StartScanLib, 10);
				return;
			}
			PendingJobTimeout = Meteor.setTimeout(checkJob, 1000);
		}; checkJob();

		return;
	}

	ScanLibJobId = Jobs.run('scanLib')._id;
	Logger("scanLib", "Scheduled new job " + ScanLibJobId);
};

Jobs.register({
	'scanLib': function() {

		Logger("scanLib", "Starting job " + this.document._id);

		var settings = Misc.findOne({ name: 'settings' });
		if (!settings.library || AbortScanLibJob) {
			Logger("scanLib", "Job " + this.document._id + " aborted on startup");
			this.failure();
			AbortScanLibJob = false;
			ScanLibJobId = false;
			return;
		}
		var status = Misc.findOne({ name: 'status' });

		var initialScan = (status.scannerRunOnLibrary === settings.library) ? false : true;
		var markAsRead = false;
		if ( initialScan && settings.initialStatus    == 'read') markAsRead = true;
		if (!initialScan && settings.subsequentStatus == 'read') markAsRead = true;
		var imageRx = new RegExp(/\.(jpg|png)$/, 'i');

		Misc.update({ name: 'status' }, { $set : { scannerStatus : 'active' } });

		if (NukeLibraryRequested) {
			Logger("scanLib", "Job " + this.document._id + " nuking library");
			Books.remove({});
			Thumbs.remove({});
			NukeLibraryRequested = false;
		}

		var dirs = [];
		try {
			var books = ScanDir(settings.library, false, false, dirs);
			Logger("scanLib", "Job " + this.document._id + " found " + books.length + " books");
			books.every((book) => {

				var existingBook = Books.findOne({ _id: book._id });
				if (existingBook) {

					// Reappeared?
					if (existingBook.missing) {
						Books.update({ _id: book._id }, { $set : { missing: false }});
						Logger(book.name, "Reappeared after being missing");
					}
					
					// Internal move?
					if (existingBook.dir !== book.dir) {
						Books.update({ _id: book._id }, { $set : { dir: book.dir }});
						Logger(book.name, "Changed to directory '" + book.dir + "'");
					}

					return true;
				}

				Logger(book.name, "Trying to add as new book, id " + book._id);
				temp.track();
				var tmpDir = UnpackSync(settings.library, book);
				var files = ReaddirSync(tmpDir).filter(file => { return file.match(imageRx) })
					.sort((a,b) => {
						if (a.toLowerCase() > b.toLowerCase()) return 1;
						if (a.toLowerCase() < b.toLowerCase()) return -1;
						return 0;
					});
				if (!files[0]) {
					Logger(book.name, "Book does not contain any images, aborting");
					temp.cleanup();
					return true;
				}
				book.numPages = files.length;
				book.pages = [];
				files.forEach(file => {
					var stats = fs.statSync(tmpDir + path.sep + file);
					book.pages.push({
						file: file,
						size: stats.size
					});
				});
				var out;
				try {
					out = ExecFileSync(convertBin, [
						tmpDir + path.sep + files[0],
						'(',
						'+clone',
						'-resize', 'x600',
						'-write',
						tmpDir + path.sep + '_stacks-thumb.jpg',
						')',
						'-resize', 'x600',
						'info:'
					]);
				} catch(e) { out = '' };
				var s = out.match(new RegExp(/\s+([0-9]+)x600\s+/ ));
				if (!s[1]) {
					Logger(book.name, "Unable to parse convert output, aborting");
					temp.cleanup();
					return true;
				}
				book.thumbAr = parseFloat(sprintf("%.3f", parseInt(s[1]) / 600));

				var stats = fs.statSync(tmpDir + path.sep + '_stacks-thumb.jpg');
				if (!stats || !stats.size) {
					Logger(book.name, "Unable to generate thubnail, aborting");
					temp.cleanup();
					return true;
				}
				var thumbDataURL = 'data:image/jpeg;base64,'
					+ fs.readFileSync(tmpDir + path.sep + '_stacks-thumb.jpg', { encoding: 'base64'})
					.replace((new RegExp(/[\/\+\=]/,'g')), function(s) { return sprintf('%%%02X', s.charCodeAt()) });

				Thumbs.insert({
					_id: book._id,
					base64: thumbDataURL
				});

				temp.cleanup();

				book.isRead = markAsRead;

				//Logger("scanLib", "new book", book);
				Books.insert(book);
				Logger(book.name, "Successfully added as new book with ID " + book._id);

				return AbortScanLibJob ? false : true;
			});
		}
		catch(e) {
			// Something segged
			Logger("scanLib","Exception during job", e);
			AbortScanLibJob = true;
		}

		if (AbortScanLibJob) {
			Logger("scanLib", "Job aborted");
			this.failure();
		}
		else {
			// Mark missing books as missing
			Books.update({ _id: { $nin: books.map(book => book._id) } }, { $set: { missing: true } }, {multi:true});
			LibrarySubDirs = dirs;
			this.success();

			Misc.update({ name: 'status' }, { $set : { scannerRunOnLibrary: settings.library } });
		}

		Misc.update({ name: 'status' }, { $set : { scannerStatus : false } });
		AbortScanLibJob = false;
		ScanLibJobId = false;
	}
});


Meteor.startup(() => {
	Logger("startup", "Stacks server starting");

	Jobs.clear('*');
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

	Misc.find({ name: 'status' }).observeChanges({
		changed(id, fields) {
			if (fields.scannerStatus === false) {
				// Scanner exited
				Logger("state", "Scanner exited");
				var status   = Misc.findOne({name:'status'});
				var settings = Misc.findOne({name:'settings'});
				if (settings.library === status.scannerRunOnLibrary) {
					
					// Delete old watchers
					Object.keys(Watchers).forEach(path => {
						if (Watchers[path]) Watchers[path].close();
						Watchers[path] = null; delete Watchers[path];
					});

					// Set up new watchers
					var watchListenerTimeout = false;
					var watchListener = function(type, filename) {
						if (watchListenerTimeout) Meteor.clearTimeout(watchListenerTimeout);
						Logger("state", "Watch event, (re-)scheduling library scan in 5 seconds");
						watchListenerTimeout = Meteor.setTimeout(StartScanLib, 5000);
					};

					Logger("state", "Watching " + LibrarySubDirs.length + " directories");
					LibrarySubDirs.forEach( dir => {
						if (!Watchers[settings.library + path.sep + dir]) {
							Watchers[settings.library + path.sep + dir] = fs.watch(settings.library + path.sep + dir, {}, Meteor.bindEnvironment((type,filename) => { watchListener(type, filename) }));
						}
					});

				}
			}
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
