var Mu = Mu || {};
Mu.conf = {
    title: "Google Music",
    domain: "*://play.google.com/music/*",
    icon: "https://music.yandex.ru/blocks/common/badge.play-google.png",
    selectors: {
        play: "paper-icon-button[data-id='play-pause']",
        next: "paper-icon-button[data-id='forward']",
        prev: "paper-icon-button[data-id='rewind']",
        artist: "#player-artist",
        title: "#player-song-title",

        player: "#player",

        stateCont: "paper-icon-button[data-id='play-pause']",
        stateClass: "playing"
    }
};
