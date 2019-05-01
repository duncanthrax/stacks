import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';

import './main.html';

Router.options.autoStart = false;

LocalForage = require('localforage');

SessionAmplify = Object.create(Session);
Object.assign(SessionAmplify, {
    keys: _.object(_.map(amplify.store(), function(value, key) {
        return [key, JSON.stringify(value)]
    })),
    set: function (key, value) {
        Session.set.apply(this, arguments);
        amplify.store(key, value);
    }
});

ToggleFullScreen = function() {
    var doc = window.document;
    var docEl = doc.documentElement;

    var requestFullScreen = docEl.requestFullscreen || docEl.mozRequestFullScreen || docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
    var cancelFullScreen = doc.exitFullscreen || doc.mozCancelFullScreen || doc.webkitExitFullscreen || doc.msExitFullscreen;

    if (!doc.fullscreenElement && !doc.mozFullScreenElement && !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
        requestFullScreen.call(docEl);
    }
    else {
        cancelFullScreen.call(doc);
    }
};

Books          = new Mongo.Collection('books');
Misc           = new Mongo.Collection('misc');
ViewportWidth  = new ReactiveVar(false);
ViewportHeight = new ReactiveVar(false);
ScrollbarWidth = new ReactiveVar(0);
ScrollbarHeight= new ReactiveVar(0);
NumStackColumns= new ReactiveVar(SessionAmplify.get('numStackColumns') || 3);
NumBookColumns = new ReactiveVar(SessionAmplify.get('numBookColumns') || 5);
ControlHit     = new ReactiveVar(false);
HintActive     = new ReactiveVar(false);
ActiveLayer    = new ReactiveVar('stacks');
ActiveStack    = new ReactiveVar({});
ActiveBookId   = new ReactiveVar(false);
ViewMode       = new ReactiveVar('fit');
Message        = new ReactiveVar(false);
RenderOk       = new ReactiveVar(false);
RenderDone     = new ReactiveVar(false);

ViewerScrollDir = 'down';

// Pages are managed with jQuery
Pages = false;
PageJq = false;

Thumbs = new ReactiveDict('thumbs');
ThumbsLoading = {};
LoadThumb = function(bookId) {

    if (!ThumbsLoading[bookId]) {
        ThumbsLoading[bookId] = true;
        LocalForage.getItem(bookId, function(err, dataUrl) {
            if (err || !dataUrl) {
                Meteor.call('getThumb', bookId, function(err, dataUrl) {
                    if (err) {
                        console.log("Error loading thumb: ", err);
                    }
                    else {
                        LocalForage.setItem(bookId, dataUrl);
                        Thumbs.set(bookId, dataUrl);
                    }
                    delete ThumbsLoading[bookId];
                    if (!Object.keys(ThumbsLoading).length) Message.set(false);
                });
            }
            else Thumbs.set(bookId, dataUrl);
            delete ThumbsLoading[bookId];
            if (!Object.keys(ThumbsLoading).length) Message.set(false);
        });
    }
}

Template.registerHelper('loadThumb', function(bookId) {

    var dataUrl = Thumbs.get(bookId);
    if (dataUrl) return dataUrl;

    Message.set("Loading covers");
    Meteor.setTimeout(function() { LoadThumb(bookId) }, 300);

    return 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
});

Icons = new ReactiveDict('icons');
IconsLoading = {};
Template.registerHelper('icon', function(iconId, color, size) {
    if (!color || typeof(color) == 'object') color = '#ffffff';
    if (!size || typeof(size) == 'object') size = 32;
    var svg = Icons.get(iconId);

    if (!svg && !IconsLoading[iconId]) {
        IconsLoading[iconId] = true;
        Meteor.call('getIcon', iconId, function(err, svgData) {
            if (err) {
                delete IconsLoading[iconId];
                console.log("Error loading icon: ", err);
                return;
            };
            Icons.set(iconId, svgData);
            delete IconsLoading[iconId];
        });
    }

    return svg ?
        svg
        .replace(new RegExp(/\#000000/, 'g'), color)
        .replace(/width="16"/, 'width="' + size + '"')
        .replace(/height="16"/, 'height="' + size + '"')
        : '';
});

Template.layers.helpers({
    layerStyle: function(layer) {
        var style = {
            'z-index' : 0
        };

        if (ActiveLayer.get() == layer)
            style['z-index'] = 500;

        switch (layer) {
            // Always on top
            case 'controls':
                style['z-index'] = 999;
            break;
            // Hide right scrollbar
            case 'settings':
            case 'books':
            case 'stacks':
                style['right'] = (-ScrollbarWidth.get())+'px';
            break;
        }

        return Object.keys(style).map(key => { return key+':'+style[key] }).join(';');
    }
});

Template.layers.onRendered(function() {
    RenderDone.set(true);
});

Template.controls.helpers({
    controlClasses: function(control) {
        var activeLayer = ActiveLayer.get();
        var controlHit  = ControlHit.get();
        var hintActive  = HintActive.get();

        var classes = [];

        var hideControls = {
            stacks  : ['close', 'prev', 'next', 'mode' ],
            books   : ['logo', 'prev', 'next', 'mode'],
            viewer  : ['logo', 'colup', 'coldown'],
            settings: ['logo', 'prev', 'next', 'mode', 'colup', 'coldown', 'settings']
        };

        if (hideControls[activeLayer].includes(control))
            classes.push('removed');
        else if (activeLayer == 'viewer') {
            classes.push('hidden');
            if (hintActive) classes.push('hinted');
        }

        if (controlHit == control) classes.push('hinted');

        Meteor.setTimeout(function() { ControlHit.set(false); HintActive.set(false) }, 300);

        return classes.join(' ');
    }
});

Template.controls.events({
    'click .control': function(e) {
        var which = $(e.target).closest('.control').attr('id');

        ControlHit.set(which);

        switch (which) {
            case 'mode':
                if (ViewMode.get() == 'fit') ViewMode.set('scroll');
                else ViewMode.set('fit');
            break;
            case 'next':
                var activeBook = Books.findOne({ _id: ActiveBookId.get() });
                if (!activeBook) return;
                var activePage = activeBook.activePage || 0;
                if (activePage < (activeBook.pages.length-1))
                    Books.update({_id: ActiveBookId.get()}, { $inc : { activePage: 1 } });
            break;
            case 'prev':
                var activeBook = Books.findOne({ _id: ActiveBookId.get() });
                if (!activeBook) return;
                var activePage = activeBook.activePage || 0;
                if (activePage > 0)
                    Books.update({_id: ActiveBookId.get()}, { $inc : { activePage: -1 } });
            break;
            case 'logo':
            break;
            case 'fscreen':
                ToggleFullScreen();
            break;
            case 'settings':
                ActiveLayer.set('settings');
            break;
            case 'close':
                switch (ActiveLayer.get()) {
                    case 'settings' : ActiveLayer.set('stacks'); break;
                    case 'books'    : ActiveLayer.set('stacks'); break;
                    case 'viewer'   :
                        ActiveBookId.set(false);
                        ActiveLayer.set('books');
                    break;
                }
            break;
            case 'colup':
                switch (ActiveLayer.get()) {
                    case 'stacks':
                        var num = NumStackColumns.get() + 1;
                        NumStackColumns.set(num > 10 ? 10 : num);
                    break;
                    case 'books':
                        var num = NumBookColumns.get() + 1;
                        NumBookColumns.set(num > 10 ? 10 : num);
                    break;
                }
            break;
            case 'coldown':
                switch (ActiveLayer.get()) {
                    case 'stacks':
                        var num = NumStackColumns.get() - 1;
                        NumStackColumns.set(num < 1 ? 1 : num);
                    break;
                    case 'books':
                        var num = NumBookColumns.get() - 1;
                        NumBookColumns.set(num < 1 ? 1 : num);
                    break;
                }
            break;
        }
        return false;
    }
});


Template.stacks.helpers({

    stacks: function() {
        var stackMap = {};
        Books.find({ missing: false }).forEach(book => {

            if (!stackMap[book.stackId])
                stackMap[book.stackId] = {
                    id  : book.stackId,
                    name: book.stackName,
                    hasUnread: 0,
                    hasNew: 0
                };

            if (book.isRead) return;

            var activePage = parseInt(book.activePage);
            var maxPage = parseInt(book.numPages);
            var mtime = parseInt(book.mtime);

            // More than 2/3 read is "read".
            if (activePage && activePage > (maxPage * 2/3)) return;

            stackMap[book.stackId].hasUnread++;

            if (mtime > (Date.now() - (1000 * 14 * 86400))) stackMap[book.stackId].hasNew++;

        });

        return Object.values(stackMap).sort((a, b) => {
            if (!a.hasNew &&  b.hasNew) return 1;
            if ( a.hasNew && !b.hasNew) return -1;

            if (!a.hasUnread &&  b.hasUnread) return 1;
            if ( a.hasUnread && !b.hasUnread) return -1;

            if (a.id > b.id) return 1;
            if (a.id < b.id) return -1;

            return 0;
        });
    },

    noBooks: function() {
        var status = Misc.findOne({ name: 'status' });

        if (!status.scannerStatus && !Books.find({ missing: false }).count())
            return true;

        return false;
    },

    stackBooks: function(stackId) {
        var lastAr = false;
        return Books.find(
            { missing: false, stackId: stackId },
            { sort: [['order', 'asc']] }
        ).fetch().slice(0,36).map((book,idx,all) => {
            book.stackIdx = idx;
            book.stackHeight = all.length;
            if (idx >= 3) book.noStackCover = lastAr;
            else lastAr = book.thumbAr;
            return book;
        });
    },

    stackAttrs: function() {
        var numStackColumns = NumStackColumns.get();
        SessionAmplify.set('numStackColumns', numStackColumns);

        var stackSize = parseInt( Math.floor(ViewportWidth.get() / numStackColumns) );
        return { style: 'width: ' + stackSize + 'px;' +
                        'height: ' + stackSize + 'px;' +
                        'font-size: ' + Math.floor(stackSize / 20) + 'px;'
                };
    },

    coverAttrs: function() {

        var height = Math.floor((this.stackHeight - this.stackIdx) * 1.5);
        var blur = Math.floor(this.stackHeight * 1.5);
        return this.noStackCover ?
        { style: 'transform: translate(calc(-50% + '+((this.stackIdx*1)-2)+'px), calc(-50% + '+((this.stackIdx*1)-2)+'px)) rotate(' + (2 * 10) + 'deg);' +
            'width:' + (65 * this.noStackCover) + '%;' +
            'z-index: ' + (100 - this.stackIdx) + ';' }
        :
        { style: 'transform: translate(-50%, -50%) rotate(' + (this.stackIdx * 10) + 'deg);' +
                'width:' + (65 * this.thumbAr) + '%;' +
                'z-index: ' + (100 - this.stackIdx) + ';' +
                'box-shadow: ' + height + 'px ' + height + 'px ' + blur + 'px ' + height + 'px rgba(0,0,0,0.2)'
        };
    }

});

Template.stacks.events({
    'click .stack': function() {
        ActiveStack.set(this);
        ActiveLayer.set('books');
    }
});

Template.settings.helpers({
    settingVal: function(which) {
        var settings = Misc.findOne({name:'settings'});
        if (!settings) return '';
        return settings[which];
    },

    optionSelected: function(which, value) {
        var settings = Misc.findOne({name:'settings'});
        if (!settings) return '';
        return (settings[which] == value) ? 'selected' : '';
    }
});

Template.settings.events({
    'click button': function(e) {
        var which = $(e.target).closest('button').attr('id');
        var settings = {};

        ['library','initialStatus','subsequentStatus','unreadMatch'].forEach(item => {
            settings[item] = $('.settings#' + item).val() || '';
        });
        settings['fullRescan'] = which == 'apply-rescan' ? true : false;

        Meteor.call('setSettings',settings);
    }

});

Template.books.created = function() {
  this.menuOpenBookId = new ReactiveVar(false);
};

Template.books.helpers({

    books: function() {
        return Books.find(
            { missing: false, stackId: ActiveStack.get().id },
            { sort: [['order', 'asc']] }
        ).fetch().map((book,idx,all) => {
            return book;
        });
    },

    menuOpen: function() {
        var self = Template.instance();

        return self.menuOpenBookId.get() == this._id;
    },

    bookStatus: function() {
        if (this.isRead) return '';

        var activePage = parseInt(this.activePage);
        var maxPage = parseInt(this.numPages);

        // More than 2/3 read is "read".
        if (activePage && activePage > (maxPage * 2/3)) return '';

        if (activePage) return 'status-started';

        return 'status-unread';
    },

    bookIsNew: function() {
        if (this.isRead) return false;

        var activePage = parseInt(this.activePage);
        var mtime = parseInt(this.mtime);

        if (activePage) return false;
        if (mtime > (Date.now() - (1000 * 14 * 86400))) return true;

        return false;
    },

    bookPages: function() {
        if (this.activePage)
            return (this.activePage+1) + '/' + this.numPages + ' p';
        return this.numPages + ' p';
    },

    title: function() {
        return ActiveStack.get().name;
    },

    bookAttrs: function() {
        var numBookColumns = NumBookColumns.get();
        SessionAmplify.set('numBookColumns', numBookColumns);

        var bookSize = parseInt( Math.floor(ViewportWidth.get() / numBookColumns) );
        return { style: 'width: ' + bookSize + 'px;' +
                        'font-size: ' + Math.floor(bookSize / 12) + 'px;'
                };
    },

    coverAttrs: function() {
        var numBookColumns = NumBookColumns.get();
        var bookSize = parseInt( Math.floor(ViewportWidth.get() / numBookColumns) );

        return { style: 'height:' + ((bookSize/100 * 90) / this.thumbAr) + 'px;' };
    }

});

Template.viewer.onRendered(function() {
    var self = Template.instance();

    PageJq = $('#page');

    // Viewer is managed by jQuery
    this.autorun(function() {
        var activeLayer = ActiveLayer.get();
        $('#viewer').css('z-index', (activeLayer == 'viewer') ? 500 : 0);
    });
});

Template.books.events({
    'click .cover>img': function(e, self) {
        if (self.menuOpenBookId.get() == this._id) return;
        ActiveBookId.set(this._id);
        ActiveLayer.set('viewer');
    },
    'click .actions': function(e, self) {
        $(e.target).closest('button').blur();
        self.menuOpenBookId.set(self.menuOpenBookId.get() == this._id ? false : this._id);
    },
    'click .menuitem': function(e, self) {
        var which = $(e.target).closest('div').data('action');
        Meteor.call('bookAction', which, this._id);
        self.menuOpenBookId.set(false);
    }
});

CursorVisible = false;
CursorHideTimeout = false;
Template.viewer.events({
    'mousemove': function() {
        // Avoid slamming the DOM
        if (!CursorVisible) {
            $('.layer#viewer').css('cursor','auto');
            CursorVisible = true;
        }
        if (CursorHideTimeout) Meteor.clearTimeout(CursorHideTimeout);
        CursorHideTimeout = Meteor.setTimeout(function() { $('.layer#viewer').css('cursor','none'); CursorVisible = false; }, 1000);
    }
});

Template.body.helpers({
    dataReady: function() {
        return RenderOk.get();
    }
});

Template.body.events({

    'contextmenu': function(e) {
        var layer = $(e.target).closest('.layer').attr('id');
        if (layer == 'viewer') return false;
        return true;
    },

    'mousedown': function(e) {
        var layer = $(e.target).closest('.layer').attr('id');

        if (layer != 'viewer') return true;
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();

        switch(e.button) {
            case 0:
                // Left mouse button
                $('.control#next').click();
            break;
            case 1:
                // Middle mouse button
                $('.control#mode').click();
            break;
            case 2:
                // Right mouse button
                $('.control#prev').click();
            break;
        }

        //HintActive.set(true);
        return false;
    },

    'mousewheel, DOMMouseScroll': function(e) {
        e.preventDefault();
        var direction = Math.max(-1, Math.min(1, (e.originalEvent.wheelDelta || -e.originalEvent.detail))) * -1;
        var activeLayer = ActiveLayer.get();

        // Viewer gets special treatment
        if (activeLayer == 'viewer') {
            if (ViewerScrollDir == 'down') {
                var scrollInc = Math.ceil(ViewportHeight.get() / 10);
                var curPos = $('.layer#viewer').scrollTop();
                curPos += (scrollInc * direction) ;
                $('.layer#viewer').scrollTop(curPos);
            }
            else {
                var scrollInc = Math.ceil(ViewportWidth.get() / 10);
                var curPos = $('.layer#viewer').scrollLeft();
                curPos += (scrollInc * direction) ;
                $('.layer#viewer').scrollLeft(curPos);
            }
            return false;
        }

        // Other layers
        var scrollInc = 100;
        if (activeLayer == 'books')  scrollInc = Math.floor(ViewportWidth.get() / NumBookColumns.get() / 2);
        if (activeLayer == 'stacks') scrollInc = Math.floor(ViewportWidth.get() / NumStackColumns.get() / 3);
        var top = $('.layer#'+activeLayer).scrollTop();
        top += (scrollInc * direction);
        $('.layer#'+activeLayer).scrollTop(top);
        return false;
    }

});


Image.prototype.xhrLoad = function(url, progressCb){
    var self = this;
    self.xhr = new XMLHttpRequest();
    self.xhr.open('GET', url, true);
    self.xhr.responseType = 'arraybuffer';
    self.xhr.onprogress = function(e) { progressCb(false, e.loaded) };
    self.xhr.onloadstart = function(e) { progressCb(false, 0) };
    self.xhr.onload = function() {
        self.src = window.URL.createObjectURL(new Blob([this.response]));
        this.response = null;
        progressCb(true);
    };
    self.xhr.send();
};

Image.prototype.xhrLoadAbort = function() {
  var self = this;
  if (self.xhr) self.xhr.abort();
};


Meteor.startup(function() {

    var subs = ['books', 'misc'].map((subname) => { return Meteor.subscribe(subname) });

    Tracker.autorun(() => {
        if (subs.find((sub) => { return !sub.ready() })) return false;
        console.log("Subs ready");
        // Check if we have settings and status
        var settings = Misc.findOne({ name: 'settings' });
        var status = Misc.findOne({ name: 'status' });

        if (settings && status) {
            console.log("Rendering");
            RenderOk.set(true);
        }
    });

    Tracker.autorun(() => {
        if (!RenderDone.get()) return;

        ScrollbarWidth.set($('#viewer').get(0).offsetWidth  - $('#viewer').get(0).clientWidth);
        ScrollbarHeight.set($('#viewer').get(0).offsetHeight - $('#viewer').get(0).clientHeight);

        $('#viewer').addClass('fit');

        $( window ).resize(function() {
          ViewportWidth.set( $('body').width() );
          ViewportHeight.set( $('body').height() );
        });
        ViewportWidth.set( $('body').width() );
        ViewportHeight.set( $('body').height() );
    });


    Tracker.autorun(() => {
        if (!RenderDone.get()) return;

        var message = Message.get();
        var status = Misc.findOne({ name: 'status' });

        if (status.scannerStatus) {
            $('#message').text("Scanner active").addClass('open');
            return;
        }

        if (message)
            $('#message').text(message).addClass('open');
        else
            $('#message').removeClass('open');
    });

    // Running when ActiveBookId changes
    Tracker.autorun(() => {
        if (!RenderDone.get()) return;

        // Flush viewer display
        PageJq.find('img').remove();

        // Abort load of old pages, dispose.
        if (Pages) {
            Pages.forEach((page) => {
                if (!page.img) return;
                page.img.xhrLoadAbort();
                page.img = null;
            });
        }

        var activeBookId = ActiveBookId.get();

        var activeBook = Tracker.nonreactive(function() { return Books.findOne({ _id: activeBookId }) });
        if (!activeBook) return;

        console.log("Loading pages for book", activeBook.name);

        // Clone pages from book
        Pages = activeBook.pages.map(page => {
            var image = (new Image());
            image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            PageJq.append(image);
            return {
                file         : page.file,
                size         : page.size,
                img          : image,
                loaded       : false,
                loadedBytes  : 0,
                loadedPercent: 0
            }
        });

        var pageChainLoader; pageChainLoader = function() {
            var activeBook = Tracker.nonreactive(function() { return Books.findOne({ _id: activeBookId }) });
            if (!activeBook) return;
            var startPage = activeBook.activePage || 0;
            var nextPage = startPage;
            while (Pages[nextPage].loaded) {
                nextPage++;
                if (!Pages[nextPage]) nextPage = 0;
                if (nextPage == startPage) {
                    return;
                }
            }
            Pages[nextPage].loading = true;
            Pages[nextPage].img.xhrLoad('page/' + activeBook._id + '/' + nextPage, function(done, loadedBytes) {
                if (done) {
                    Pages[nextPage].loaded = true;
                    // Load next page
                    Meteor.setTimeout(pageChainLoader, 5);
                }
                else {
                    Pages[nextPage].loadedBytes = loadedBytes;
                    Pages[nextPage].loadedPercent = parseInt(loadedBytes / (Pages[nextPage].size / 100));
                    var latestBookId = ActiveBookId.get();
                    var latestBook = Tracker.nonreactive(function() { return Books.findOne({ _id: latestBookId }) });
                    if (!latestBookId || !latestBook) return;
                    // If this is the book/page currently shown, update progress meter.
                    if (latestBookId == activeBook._id && latestBook.activePage == nextPage) {
                        $('#progress').html(Pages[nextPage].loadedPercent + '%');
                    }
                }
            });
        };
        pageChainLoader();

    });

    // Running when ActiveBookId or underlying book change
    var shownBookId = false;
    var shownPage = false;
    Tracker.autorun(() => {
        if (!RenderDone.get()) return;

        var activeBook = Books.findOne({ _id: ActiveBookId.get() });
        var viewMode = ViewMode.get();
        var viewportWidth = ViewportWidth.get();
        var viewportHeight = ViewportHeight.get();
        if (!activeBook) return;

        var activePage = activeBook.activePage || 0;

        // Check if we must flip page
        if ((shownBookId != activeBook._id) || (shownPage != activePage)) {
            console.log("Flipping to page", activePage, "of", activeBook.name);
            PageJq.css('width','100%').css('height','100%').find('img').hide();
            $('#progress').html(Pages[activePage].loadedPercent + '%');
        }

        shownBookId = activeBook._id;
        shownPage   = activePage;

        // Set view mode
        var waitForRender; waitForRender = function(thisBook, thisPage, delayed) {
            var pageImg = Pages[thisPage].img;
            var naturalWidth = pageImg.naturalWidth;
            if (!naturalWidth || naturalWidth < 2) {
                Meteor.setTimeout(function() { waitForRender(thisBook, thisPage, true) }, 50);
                //console.log("Waiting for render");
                return;
            }

            // Abort if we are deferred and book/page have changed in the meantime
            if (delayed) {
                var latestBook = Tracker.nonreactive(function() { return Books.findOne({ _id: ActiveBookId.get() }) });
                var latestPage = latestBook.activePage || 0;
                if (latestBook._id != thisBook._id || latestPage != thisPage) return;
            }

            var pageWidth  = pageImg.naturalWidth;
            var pageHeight = pageImg.naturalHeight;
            var viewerAr   = viewportWidth / viewportHeight;
            var pageAr     = pageWidth / pageHeight;

            PageJq.find('img').eq(thisPage).show();

            if (viewMode == 'fit') {

                $('#viewer').removeClass('scroll-down scroll-right').addClass('fit')
                    .css('right','0px').css('bottom','0px');

                if (viewerAr > pageAr) {
                    // Screen AR wider than Page AR
                    // => Black bars left/right
                    // => Fit height
                    console.log("Fit - Vertical");
                    PageJq.width(Math.floor(pageWidth * (viewportHeight / pageHeight)));
                    PageJq.height(viewportHeight);
                }
                else {
                    // Screen AR smaller than Page AR
                    // => Black bars top/bottom
                    // => Fit width
                    console.log("Fit - Horizontal");
                    PageJq.height(Math.floor(pageHeight * (viewportWidth / pageWidth)));
                    PageJq.width(viewportWidth);
                }
            }
            else {
                if (viewerAr > pageAr) {
                    // Screen AR wider than Page AR
                    // => Fit width, scroll down
                    console.log("Scroll - Vertical");
                    ViewerScrollDir = 'down';
                    $('#viewer').removeClass('fit').addClass('scroll-down')
                        .css('right', -(ScrollbarWidth.get()) + 'px')
                        .css('bottom', '0px').scrollTop(0);
                    PageJq.height(Math.floor(pageHeight * (viewportWidth / pageWidth)));
                    PageJq.width(viewportWidth);
                }
                else {
                    // Screen AR wider than Page AR
                    // => Fit height, scroll right
                    console.log("Scroll - Horizontal");
                    ViewerScrollDir = 'right';
                    $('#viewer').removeClass('fit').addClass('scroll-right')
                        .css('right', '0px')
                        .css('bottom', -(ScrollbarHeight.get()) + 'px').scrollLeft(0);
                    PageJq.width(Math.floor(pageWidth * (viewportHeight / pageHeight)));
                    PageJq.height(viewportHeight);
                }
            }
        };

        waitForRender(activeBook, activePage, false);
    });

});
