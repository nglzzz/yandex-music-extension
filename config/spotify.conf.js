var Mu = Mu || {};
Mu.conf = {
    title: "Spotify",
    domain: "*://*spotify.com/*",
    icon: "https://w7.pngwing.com/pngs/144/728/png-transparent-spotify-social-media-soundcloud-music-social-media-television-logo-vector-icons.png",
    trackRegExp: /(:<artist>.*)\s*–\s*(:<title>.*)/,
    selectors: {
        play: ".player-controls__buttons [data-testid=\"control-button-play\"], .player-controls__buttons [data-testid=\"control-button-pause\"]",
        next: ".player-controls__buttons [data-testid=\"control-button-skip-forward\"]",
        prev: ".player-controls__buttons [aria-label=\"Previous\"]",
        title: "a[data-testid=\"nowplaying-track-link\"]",

        player: ".player-controls",

        stateCont: ".now-playing-bar"
    }
};

