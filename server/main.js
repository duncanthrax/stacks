import { Meteor } from 'meteor/meteor';
import { Jobs } from 'meteor/msavin:sjobs';
import { EJSON } from 'meteor/ejson';

var fs = require('fs');
var crypto = require('crypto');
var temp = require('temp');
var sprintf = require('sprintf-js').sprintf;
var execFile = require('child_process').execFile;

let {msleep} = require('usleep');

var rarBin = '/usr/bin/unrar';
var zipBin = '/usr/bin/unzip';
var convertBin = '/usr/bin/convert';

Books = new Mongo.Collection('books');
Thumbs = new Mongo.Collection('thumbs');
Misc = new Mongo.Collection('misc');

UnpackPaths = {};

ReaddirSync = Meteor.wrapAsync(function(dir, cb) { fs.readdir(dir, cb) });
ExecFileSync = Meteor.wrapAsync(function(cmd, opts, cb) {
	execFile(cmd, opts, function(error, stdout, stderr) {
		cb(error ? error.code : null, stdout.replace(new RegExp(/\s+/, 'g'), ' '));
	});
});

UnpackSync = function(book) {
	var tmpDir = temp.mkdirSync('stacks-tmp-book-' + book._id);
	if (book.type == 'cbr') {
		try {
			ExecFileSync(rarBin, ['e', '-o+', '-y', '-p-', '-inul', book.path + book.file, tmpDir]);
		} catch (code) {
			console.log(rarBin, "returned exit code", code);
			// Some CBRs are actually CBZs
			try { ExecFileSync(zipBin, ['-o', '-j', '-qq', book.path + book.file, '-d', tmpDir]) } catch(e) {};
		}
	}
	else if (book.type == 'cbz') {
		try { ExecFileSync(zipBin, ['-o', '-j', '-qq', book.path + book.file, '-d', tmpDir]) } catch(e) {};
	}
	return tmpDir;
};


ScanDir = function(base, dir, books) {
	dir = dir || '';
	books = books || [];

	ReaddirSync(base + '/' + dir).forEach((file) => {
		file = dir + '/' + file;
		var stats = fs.statSync(base + '/' + file);
		if (stats && stats.isDirectory()) ScanDir(base, file, books);
		else {
			var m; m = file.match(new RegExp(/\/([^/]+)\.(cbr|cbz)$/,'i'));
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

			if (!m) {
				console.log("Unable to parse filename:", name);
				return;
			}

			var stackName = m[1];
			var order = m[2];
			order = order.replace(new RegExp(/\#/,'g'), '');

			var id = crypto.createHash('sha1').update(stats.mtime.toString()).update(name.toLowerCase().replace(new RegExp(/\s/,'g'), '')).digest('hex');
			var stackId = stackName.toLowerCase().replace(new RegExp(/[^a-z0-9]/,'g'), '');

			books.push({
					  _id: id,
					 name: name,
				  stackId: stackId,
				stackName: stackName,
				    order: sprintf("#%05s", order),
				     type: type,
				     path: base,
				     file: file,
				     size: stats.size,
				    mtime: Math.floor(stats.mtimeMs)
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
			try { data = fs.readFileSync(path + '/' + page.file) } catch (e) { return null };
			return data;
		};

		var pageNum = parseInt(this.params[1]);
		if (pageNum == NaN) return fourOfour();

		var book = Books.findOne({ _id: this.params[0] });
		if (!book) return fourOfour();

		var page = book.pages[pageNum];
		if (!page) return fourOfour();

		var data = null;
		if (UnpackPaths[book._id]) data = readPage(UnpackPaths[book._id], page);
		if (!data) {
			UnpackPaths[book._id] = UnpackSync(book);
			data = readPage(UnpackPaths[book._id], page);
		}

		if (!data) return fourOfour();

		fs.unlinkSync(UnpackPaths[book._id] + '/' + page.file);

		this.response.writeHead(200, { 'Content-Type': 'image' });
		this.response.write(data);
		this.response.end();
	}
});

ScanLibJobLock = false;
StartScanLib = function() {
	var job = Jobs.run('scanLib');
	ScanLibJobLock = job._id;
	console.log("Scheduled new scanLib job", job._id);
};

Jobs.register({
	'scanLib': function() {
		var settings = Misc.findOne({ name: 'settings' });
		if (!settings.library) {
			this.success();
			this.remove();
			return;
		}

		Misc.update({ name: 'scannerStatus' }, { $set : { status : 'active' } });

		var books = ScanDir(settings.library);
		var imageRx = new RegExp(/\.(jpg|png)$/, 'i');

		var aborted = false;
		books.every((book) => {
			if (Books.find({ _id: book._id }).count()) return true;

			console.log("[new]", book._id, book.stackId, book.order, book.type, book.name);

			temp.track();
			var tmpDir = UnpackSync(book);
			var files = ReaddirSync(tmpDir).filter(file => { return file.match(imageRx) })
				.sort((a,b) => {
					if (a.toLowerCase() > b.toLowerCase()) return 1;
					if (a.toLowerCase() < b.toLowerCase()) return -1;
					return 0;
				});
			if (!files[0]) {
				console.log(book.name,"does not contain any images");
				temp.cleanup();
				return true;
			}
			book.numPages = files.length;
			book.pages = [];
			files.forEach(file => {
				var stats = fs.statSync(tmpDir + '/' + file);
				book.pages.push({
					file: file,
					size: stats.size
				});
			});
			var out;
			try {
				out = ExecFileSync(convertBin, [
					tmpDir + '/' + files[0],
					'(',
					'+clone',
					'-resize', 'x600',
					'-write',
					tmpDir + '/_stacks-thumb.jpg',
					')',
					'-resize', 'x600',
					'info:'
				]);
			} catch(e) {};
			var s = out.match(new RegExp(/\s+([0-9]+)x600\s+/ ));
			if (!s[1]) {
				console.log(book.name,"unable to get thumbnail AR");
				temp.cleanup();
				return true;
			}
			book.thumbAr = parseFloat(sprintf("%.2f", parseInt(s[1]) / 600));

			var stats = fs.statSync(tmpDir + '/_stacks-thumb.jpg');
			if (!stats || !stats.size) {
				console.log(book.name,"unable to generate thumbnail");
				temp.cleanup();
				return true;
			}
			var thumbDataURL = 'data:image/jpeg;base64,'
				+ fs.readFileSync(tmpDir + '/_stacks-thumb.jpg', { encoding: 'base64'})
				.replace((new RegExp(/[\/\+\=]/,'g')), function(s) { return sprintf('%%%02X', s.charCodeAt()) });

			Thumbs.insert({
				_id: book._id,
				base64: thumbDataURL
			});

			temp.cleanup();

			Books.insert(book);

			if (ScanLibJobLock !== this.document._id) {
				aborted = true;
				return false;
			}

			return true;
		});

		Misc.update({ name:'scannerStatus' }, { $set : { status : false } });

		if (aborted) {
			console.log("Scan job aborted");
		}
		else {
			// Mark missing books as missing
			Books.update({ _id: { $nin: books.map(book => book._id) } }, { $set: { missing: true } });
		}
		
		this.success();
		this.remove();
	}
});


Meteor.startup(() => {

	Jobs.clear('*');
	Misc.update({ name:'settings' }, { $set : { fullRescan : false } });
	Misc.update({ name:'scannerStatus' }, { $set : { status : false } });

	Meteor.publish('books', function() { return Books.find() });
	Meteor.publish('misc', function() { return Misc.find() });

	var settings = Misc.findOne({name:'settings'});
	if (!settings) {
		// Default settings
		console.log("Creating default settings");
		Misc.insert({
			name : 'settings',
			library: process.env['STACKS_LIBRARY'] || '',
			initialStatus: 'read',
			subsequentStatus: 'unread',
			unreadMatch: '',
			fullRescan: false
		});
	};
	var scannerStatus = Misc.findOne({name:'scannerStatus'});
	if (!scannerStatus) {
		Misc.insert({
			name : 'scannerStatus',
			status : false
		});
	};

	settingsCursor = Misc.find({ name: 'settings' });
	settingsCursor.observeChanges({
		changed(id, fields) {
			if (fields.library) {
				// Library location changed
				StartScanLib();
			}
			if (fields.fullRescan) {
				// Full rescan requested
				Misc.update({ name:'settings' }, { $set : { fullRescan : false } });

				Books.remove({});
				Thumbs.remove({});
				
				StartScanLib();
			}
		}
	});

	StartScanLib();

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
			Misc.update({ name:'settings' }, { $set : settings });
		}
	});
});
 