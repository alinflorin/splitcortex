// Follow the web app's choices on Dex's login pages. Dex has no i18n of its own, so this is a small en -> ro
// dictionary applied to the page text; anything not listed (e.g. server error messages) stays English.
// The web app mirrors its settings in cookies on the shared parent domain (src/ui/src/lib/sharedCookie.ts):
//   sc-theme = light|dark  (absent = "system": the stylesheet follows the OS)
//   sc-lang  = en|ro       (absent = the browser language)
(function () {
  function cookie(name, values) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=(' + values + ')'));
    return m ? m[1] : null;
  }

  var root = document.documentElement;
  var theme = cookie('sc-theme', 'light|dark');
  if (theme) root.setAttribute('data-theme', theme);

  var lang =
    cookie('sc-lang', 'en|ro') || ((navigator.language || 'en').slice(0, 2) === 'ro' ? 'ro' : 'en');
  root.setAttribute('lang', lang);
  if (lang !== 'ro') return;

  // Whole-string matches (after trimming whitespace).
  var exact = {
    'Log in to Your Account': 'Autentifică-te în contul tău',
    'Email Address': 'Adresă de email',
    'email address': 'adresă de email',
    Username: 'Utilizator',
    username: 'utilizator',
    Password: 'Parolă',
    password: 'parolă',
    Login: 'Autentificare',
    'Log in': 'Autentificare',
    'Remember me': 'Ține-mă minte',
    'Select another login method.': 'Alege altă metodă de autentificare.',
    'Grant Access': 'Acordă accesul',
    Cancel: 'Anulează',
    'Logging Out': 'Deconectare',
    'Do you want to log out?': 'Vrei să te deconectezi?',
    'Log Out': 'Deconectează-te',
    'Log out': 'Deconectează-te',
    'Logged Out': 'Deconectat',
    'You have been successfully logged out.': 'Te-ai deconectat cu succes.',
    'Session Not Found': 'Sesiune negăsită',
    'No active session found.': 'Nu există nicio sesiune activă.',
    '← Back to Application': '← Înapoi la aplicație',
    'Not signed in': 'Neautentificat',
    'This is the dex identity provider. Sign in from the application you want to use.':
      'Acesta este furnizorul de identitate. Autentifică-te din aplicația pe care vrei să o folosești.',
    'OpenID configuration': 'Configurare OpenID',
    'Signed in with': 'Autentificat cu',
    'Signed in': 'Autentificat',
    'Signed in from': 'Autentificat de la',
    'Expires if idle': 'Expiră la inactivitate',
    'Session ends': 'Sesiunea se încheie',
    Browser: 'Browser',
    '(verified)': '(verificat)',
    '(not verified)': '(neverificat)',
    'Enter User Code': 'Introdu codul',
    Submit: 'Trimite',
  };

  // Strings with a dynamic part (provider, client, field name).
  var patterns = [
    [/^Log in to (.+)$/, 'Autentifică-te în $1'],
    [/^Log in with (.+)$/, 'Autentifică-te cu $1'],
    [/^Invalid (.+) and password\.$/, '$1 sau parolă invalidă.'],
    [/^(.+) would like to:$/, '$1 dorește să:'],
    [/^(.+) has not requested any personal information$/, '$1 nu a cerut date personale'],
  ];
  function tr(text) {
    var t = text.trim();
    if (!t) return text;
    var out = exact[t];
    for (var i = 0; out === undefined && i < patterns.length; i++) {
      if (patterns[i][0].test(t)) {
        out = t.replace(patterns[i][0], function (_, a) {
          return patterns[i][1].replace('$1', exact[a] || a);
        });
      }
    }
    if (out === undefined) return text;
    return text.replace(t, out);
  }

  function apply() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var p = node.parentNode && node.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE') continue;
      var v = tr(node.nodeValue);
      if (v !== node.nodeValue) node.nodeValue = v;
    }
    document.querySelectorAll('[placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', tr(el.getAttribute('placeholder')));
    });
    document.title = tr(document.title);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
