const path    = require('path');

module.paths.push(
    path.resolve(__dirname, '..', '..', 'npm', 'node_modules')
);
module.paths.push(
    path.resolve(__dirname, '..', '..', 'node_modules')
);

const client  = require('mongodb').MongoClient;
const temp    = require('temp');
const fs      = require('fs');
const sprintf = require('sprintf-js').sprintf;
const crypto  = require('crypto');
const child   = require('child_process');

var cfg = false;

Logger = function(ctx, msg, obj) {
	if (obj) console.log(`[${ctx}]`, msg, obj);
	else     console.log(`[${ctx}]`, msg);
};

UnpackSync = function(library, book) {
	var tmpDir = temp.mkdirSync('stacks-tmp-book-' + book._id);

	// Alway try both rar/zip but start with the more likely one.
	if (book.type == 'cbr') {
		try {
			child.execFileSync(cfg.rarBin, ['e', '-o+', '-y', '-p-', '-inul', library + path.sep + book.dir + path.sep + book.file, tmpDir]);
		} catch (code) {
			Logger(book.name, cfg.rarBin + " returned exit code " + code + ", trying ZIP");
			try {
				child.execFileSync(cfg.zipBin, ['-o', '-j', '-qq', library + path.sep + book.dir + path.sep + book.file, '-d', tmpDir]);
			}
			catch(e) {
				Logger(book.name, cfg.zipBin + " returned exit code " + code);
			};
		}
	}
	else if (book.type == 'cbz') {
		try {
			child.execFileSync(cfg.zipBin, ['-o', '-j', '-qq', library + path.sep + book.dir + path.sep + book.file, '-d', tmpDir]);
		} catch (code) {
			Logger(book.name, cfg.zipBin + " returned exit code " + code + ", trying RAR");
			try {
				child.execFileSync(cfg.rarBin, ['e', '-o+', '-y', '-p-', '-inul', library + path.sep + book.dir + path.sep + book.file, tmpDir]);
			}
			catch(e) {
				Logger(book.name, cfg.rarBin + " returned exit code " + code);
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

	fs.readdirSync(base + path.sep + dir).forEach((file) => {
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
				Logger("scanner", `Unable to parse filename '${name}'`);
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


AbortScanLib = false;
ScanLib = async function() {

    var settings = await cfg.colMisc.findOne({ name: 'settings' });
    Logger("scanner", "Settings", settings);
    if (!settings || !settings.library || AbortScanLib) {
        Logger("scanner", "Aborted on startup");
        return;
    }
    var status = await cfg.colMisc.findOne({ name: 'status' });

    var initialScan = (status.scannerRunOnLibrary === settings.library) ? false : true;
    var markAsRead = false;
    if ( initialScan && settings.initialStatus    == 'read') markAsRead = true;
    if (!initialScan && settings.subsequentStatus == 'read') markAsRead = true;
    var imageRx = new RegExp(/\.(jpg|png)$/, 'i');

    //await cfg.colMisc.updateOne({ name: 'status' }, { $set : { scannerStatus : 'active' } });

    if (cfg.nukeLib) {
        Logger("scanner", "Nuking library");
        await cfg.colBooks.deleteMany({});
        await cfg.colThumbs.deleteMany({});
    }

    var unreadRx = false;
    if (settings.unreadMatch)
        unreadRx = new RegExp(RegExp.quote(settings.unreadMatch), 'i');

    var dirs = [];
    try {
        var books = ScanDir(settings.library, false, false, dirs);
        Logger("scanner", `Found ${books.length} books`);
        for (var book of books) {

            var existingBook = await cfg.colBooks.findOne({ _id: book._id });
            if (existingBook) {

                // Reappeared?
                if (existingBook.missing) {
                    await cfg.colBooks.updateOne({ _id: book._id }, { $set : { missing: false }});
                    Logger(book.name, "Reappeared after being missing");
                }

                // Internal move?
                else if (existingBook.dir !== book.dir) {
                    await cfg.colBooks.updateOne({ _id: book._id }, { $set : { dir: book.dir }});
                    Logger(book.name, "Changed to directory '" + book.dir + "'");
                }
                else {
                    //Logger(book.name, "Already exists in library");
                }

                continue;
            }

            Logger(book.name, "Trying to add as new book, id " + book._id);
            temp.track();
            var tmpDir = UnpackSync(settings.library, book);
            var files = fs.readdirSync(tmpDir).filter(file => { return file.match(imageRx) })
                .sort((a,b) => {
                    if (a.toLowerCase() > b.toLowerCase()) return 1;
                    if (a.toLowerCase() < b.toLowerCase()) return -1;
                    return 0;
                });
            if (!files[0]) {
                Logger(book.name, "Book does not contain any images, aborting");
                temp.cleanup();
                continue;
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
            var width = false;
            try {
                var out = child.execFileSync(cfg.convertBin, [
                    tmpDir + path.sep + files[0],
                    '(',
                    '+clone',
                    '-resize', 'x600',
                    '-write',
                    tmpDir + path.sep + '_stacks-thumb.jpg',
                    ')',
                    '-resize', 'x600',
                    'info:'
                ]).toString();
                var s = out.match(new RegExp(/\s+([0-9]+)x600\s+/ ));
                width = parseInt(s[1]);
            }
            catch(e) {
                Logger("scanner", `Exception while calling ${cfg.convertBin}`, e);
            };
            if (!width) {
                Logger(book.name, "Unable to parse convert output, aborting");
                temp.cleanup();
                continue;
            }
            book.thumbAr = parseFloat(sprintf("%.3f", width / 600));

            var stats = fs.statSync(tmpDir + path.sep + '_stacks-thumb.jpg');
            if (!stats || !stats.size) {
                Logger(book.name, "Unable to generate thubnail, aborting");
                temp.cleanup();
                continue;
            }
            var thumbDataURL = 'data:image/jpeg;base64,'
                + fs.readFileSync(tmpDir + path.sep + '_stacks-thumb.jpg', { encoding: 'base64'})
                .replace((new RegExp(/[\/\+\=]/,'g')), function(s) { return sprintf('%%%02X', s.charCodeAt()) });

            await cfg.colThumbs.insertOne({
                _id: book._id,
                base64: thumbDataURL
            });

            temp.cleanup();

            if (unreadRx) book.isRead = book.dir.match(unreadRx) ? false : true;
            else book.isRead = markAsRead;

            //Logger("scanner", "new book", book);
            await cfg.colBooks.insertOne(book);
            Logger(book.name, "Successfully added as new book with ID " + book._id);

            if (AbortScanLib) break;
        };
    }
    catch(e) {
        // Something segged
        Logger("scanner","Exception", e);
        AbortScanLib = true;
    }

    if (AbortScanLib) {
        Logger("scanner", "Aborted");
    }
    else {
        // Mark missing books as missing
        await cfg.colBooks.updateMany({ _id: { $nin: books.map(book => book._id) } }, { $set: { missing: true } }, { multi: true });
        // Mark initial scanner run complete
        await cfg.colMisc.updateOne({ name: 'status' }, { $set : { scannerRunOnLibrary: settings.library } });
    }

    //await cfg.colMisc.updateOne({ name: 'status' }, { $set : { scannerStatus : false } });
    Logger("scanner", "Done");

    return dirs;
}

Started = false;
process.on('message', msg => {
    Logger('scanner', `Mongo URL is ${process.env['MONGO_URL']}`);

    Logger('scanner', "got message", msg);

    if (msg.type == 'abort' && Started) {
        AbortScanLib = true;
    }

    if (msg.type == 'start' && !Started) {
        Started = true;
        cfg = msg.cfg;
        client.connect(process.env['MONGO_URL'], { useNewUrlParser: true }, function(err, cl) {
            var db = cl.db('meteor');
            cfg.colMisc = db.collection('misc');
            cfg.colBooks = db.collection('books');
            cfg.colThumbs = db.collection('thumbs');
            ScanLib().then((dirs) => {
                if (dirs) process.send({
                    type: 'dirs',
                    dirs: dirs
                });
                process.exit(0);
            });
        });
    };
});
