var Mu = Mu || {};
Mu.conf = {
    title: "Ololo",
    domain: ["*://pesni.fm/*", "*://ololo.fm/*"],
    icon: "https://music.yandex.ru/blocks/common/badge.ololo.png",
    trackRegExp: /(:<title>.*)\s*&nbsp;\s*(:<artist>.*)/,
    selectors: {
        play: "#resume[style='display: inline;'], #pause[style='display: inline;'], #pause",
        title: "#trackname",
        next: "#next_song",
        prev: "#prev_song",
        player: "#playercontrol",

        stateCont: "#resume"
    },

    overrides: {
        getState: function() {
            var elem = this._getElement(this.selectors.stateCont);
            return elem && (elem.style.display == "inline" || elem.style.display == "") ? 1 : 0;
        },
        fixTrack: function() {
            var titleEl = this._getElement(this.selectors.title);
            var title = titleEl && titleEl.innerHTML;
            var match = this.trackRegExp.exec(title);
            if (match && match.title) {
                return {
                    title: unescapeHTML(match.title),
                    artist: unescapeHTML(match.artist)
                };
            } else {
                return {
                    title: unescapeHTML(match.title)
                };
            }
        }
    }
};

var escape = document.createElement('textarea');
function unescapeHTML(html) {
    escape.innerHTML = html;
    return escape.innerText;
}
