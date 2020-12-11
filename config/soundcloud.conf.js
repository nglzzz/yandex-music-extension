var Mu = Mu || {};
Mu.conf = {
    title: "Soundcloud",
    domain: "*://soundcloud.com/*",
    icon: "https://music.yandex.ru/blocks/common/badge.soundcloud.png",
    trackRegExp: /(:<artist>.*)\s*[—\-~]\s*(:<title>.*)/,
    selectors: {
        play: ".playControls .playControl",
        next: ".playControls .skipControl__next",
        prev: ".playControls .skipControl__previous",
        artist: "#gp_performer",
        title: ".playControls .playbackSoundBadge__title span:last-child",

        player: ".playControls",

        stateCont: ".playControls .playControl",
        stateClass: "playing"
    }
};
