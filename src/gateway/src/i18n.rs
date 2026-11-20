//! Translated client-facing error messages. Errors carry a message key plus arguments (`Tr`); the language is picked
//! per request from `Accept-Language` (`en` or `ro`, English when nothing matches) when the response is built, so a
//! request forwarded to another gateway instance is answered in the same language (the header is passed on).
//! The `code` and `type` fields of the OpenAI error object are stable identifiers and are never translated.

use axum::http::HeaderMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Lang {
    #[default]
    En,
    Ro,
}

impl Lang {
    pub fn from_header(value: Option<&str>) -> Self {
        let Some(value) = value else { return Lang::En };
        let mut ranked: Vec<(f32, usize, &str)> = value
            .split(',')
            .enumerate()
            .filter_map(|(i, part)| {
                let mut it = part.trim().split(';');
                let tag = it.next()?.trim();
                let q = it
                    .find_map(|p| p.trim().strip_prefix("q=").and_then(|q| q.trim().parse::<f32>().ok()))
                    .unwrap_or(1.0);
                (q > 0.0).then_some((q, i, tag))
            })
            .collect();
        ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        for (_, _, tag) in ranked {
            match tag.split('-').next().unwrap_or("").to_ascii_lowercase().as_str() {
                "en" => return Lang::En,
                "ro" => return Lang::Ro,
                _ => {}
            }
        }
        Lang::En
    }

    pub fn from_headers(headers: &HeaderMap) -> Self {
        Self::from_header(headers.get("accept-language").and_then(|v| v.to_str().ok()))
    }

    pub fn tag(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Ro => "ro",
        }
    }
}

#[derive(Clone, Debug)]
enum Arg {
    Text(String),
    /// A catalogue word (translated on rendering).
    Word(&'static str),
    /// Several catalogue words, joined with the language's "and".
    Words(Vec<&'static str>),
}

#[derive(Clone, Debug)]
pub struct Tr {
    key: &'static str,
    args: Vec<(&'static str, Arg)>,
}

impl Tr {
    pub fn new(key: &'static str) -> Self {
        Self { key, args: Vec::new() }
    }
    pub fn arg(mut self, name: &'static str, value: impl ToString) -> Self {
        self.args.push((name, Arg::Text(value.to_string())));
        self
    }
    pub fn word(mut self, name: &'static str, key: &'static str) -> Self {
        self.args.push((name, Arg::Word(key)));
        self
    }
    pub fn words(mut self, name: &'static str, keys: Vec<&'static str>) -> Self {
        self.args.push((name, Arg::Words(keys)));
        self
    }
    pub fn render(&self, lang: Lang) -> String {
        let mut out = template(lang, self.key).to_string();
        for (name, arg) in &self.args {
            let value = match arg {
                Arg::Text(t) => t.clone(),
                Arg::Word(k) => template(lang, k).to_string(),
                Arg::Words(ks) => ks
                    .iter()
                    .map(|k| template(lang, k))
                    .collect::<Vec<_>>()
                    .join(&format!(" {} ", template(lang, "word.and"))),
            };
            out = out.replace(&format!("{{{name}}}"), &value);
        }
        out
    }
}

/// English first (the fallback and the reference), then Romanian; a key missing from Romanian shows English.
fn template(lang: Lang, key: &str) -> &'static str {
    if lang == Lang::Ro {
        if let Some((_, v)) = RO.iter().find(|(k, _)| *k == key) {
            return v;
        }
    }
    EN.iter().find(|(k, _)| *k == key).map(|(_, v)| *v).unwrap_or("Error.")
}

pub const EN: &[(&str, &str)] = &[
    ("word.and", "and"),
    ("word.image", "image"),
    ("word.audio", "audio"),
    ("limit.requests_per_minute", "requests per minute"),
    ("limit.tokens_per_minute", "tokens per minute"),
    ("limit.tokens_per_day", "tokens per day"),
    ("invalid_api_key", "Incorrect API key provided."),
    ("unauthorized", "Unauthorized."),
    ("unknown_key", "Unknown key."),
    ("temporarily_unavailable", "Temporarily unavailable."),
    ("invalid_base64", "The {what} is not valid base64."),
    ("unsupported_media_url", "The {what} must be a base64 `data:` URL; the gateway does not fetch URLs."),
    ("invalid_data_url", "The {what} is not a valid data URL."),
    ("data_url_not_base64", "The {what} must be base64 encoded."),
    ("content_shape", "message content must be a string or an array of parts"),
    ("invalid_media_role", "Images and audio are only accepted in user messages."),
    ("image_needs_url", "image_url needs a `url`"),
    ("audio_needs_data", "input_audio needs `data` and `format`"),
    ("media_empty", "A media part is empty."),
    ("unsupported_image_type", "Unsupported image type `{mime}`; use JPEG, PNG, BMP or GIF."),
    ("unsupported_audio_format", "Unsupported audio format `{format}`; use wav, mp3 or flac."),
    ("media_too_large", "A request may carry at most {parts} images or audio clips and {mib} MiB of them."),
    ("unsupported_part_type", "Unsupported content part type `{kind}`. Supported: `text`, `image_url` (base64 data URL), `input_audio`."),
    ("request_too_large", "The request body is too large."),
    ("invalid_body", "Invalid request body: {detail}"),
    ("messages_empty", "messages must not be empty"),
    ("shutting_down", "This instance is shutting down; try again."),
    ("metering_behind", "Usage metering is behind; try again shortly."),
    ("model_not_found", "The model `{model}` does not exist or you do not have access to it."),
    ("unsupported_modality", "This model does not accept {missing} input: no node of it can process it."),
    ("rate_limited", "Rate limit reached: too many {what}. Try again in {secs} s."),
    ("context_exceeded", "This model's maximum context length is {max} tokens, but the request needs about {need} (prompt plus requested output)."),
    ("no_node", "No node is available for this model right now."),
    ("model_is_embedding", "The model `{model}` is an embedding model: use /v1/embeddings."),
    ("model_is_chat", "The model `{model}` is a chat model, not an embedding model: use /v1/chat/completions."),
    ("embedding_input_empty", "input must be a non-empty string or a non-empty list of non-empty strings."),
    ("embedding_too_many", "At most {max} inputs per request."),
    ("embedding_input_long", "An input is longer than {max} characters."),
    ("embedding_bad_task", "Unknown task `{task}`; use query, document, classification, clustering or similarity."),
    ("embedding_bad_format", "encoding_format must be `float` or `base64`."),
    ("embedding_bad_dimensions", "dimensions must be a positive number."),
    ("embedding_bad_answer", "The node returned an unusable answer."),
    ("node_failed", "The node failed to answer."),
    ("node_error", "{message}"),
    ("node_disconnected", "The node disconnected."),
];

pub const RO: &[(&str, &str)] = &[
    ("word.and", "și"),
    ("word.image", "imagine"),
    ("word.audio", "audio"),
    ("limit.requests_per_minute", "cereri pe minut"),
    ("limit.tokens_per_minute", "tokeni pe minut"),
    ("limit.tokens_per_day", "tokeni pe zi"),
    ("invalid_api_key", "Cheia API furnizată este incorectă."),
    ("unauthorized", "Neautorizat."),
    ("unknown_key", "Cheie necunoscută."),
    ("temporarily_unavailable", "Temporar indisponibil."),
    ("invalid_base64", "Elementul „{what}” nu este base64 valid."),
    ("unsupported_media_url", "Elementul „{what}” trebuie să fie un URL `data:` în base64; gateway-ul nu descarcă URL-uri."),
    ("invalid_data_url", "Elementul „{what}” nu este un URL de date valid."),
    ("data_url_not_base64", "Elementul „{what}” trebuie să fie codat base64."),
    ("content_shape", "conținutul mesajului trebuie să fie un șir de caractere sau o listă de părți"),
    ("invalid_media_role", "Imaginile și audio sunt acceptate doar în mesajele utilizatorului."),
    ("image_needs_url", "image_url are nevoie de un câmp `url`"),
    ("audio_needs_data", "input_audio are nevoie de `data` și `format`"),
    ("media_empty", "O parte media este goală."),
    ("unsupported_image_type", "Tip de imagine neacceptat `{mime}`; folosește JPEG, PNG, BMP sau GIF."),
    ("unsupported_audio_format", "Format audio neacceptat `{format}`; folosește wav, mp3 sau flac."),
    ("media_too_large", "O cerere poate conține cel mult {parts} imagini sau clipuri audio și {mib} MiB din acestea."),
    ("unsupported_part_type", "Tip de parte de conținut neacceptat `{kind}`. Acceptate: `text`, `image_url` (URL de date base64), `input_audio`."),
    ("request_too_large", "Corpul cererii este prea mare."),
    ("invalid_body", "Corp de cerere invalid: {detail}"),
    ("messages_empty", "messages nu poate fi gol"),
    ("shutting_down", "Această instanță se oprește; încearcă din nou."),
    ("metering_behind", "Contorizarea consumului este în urmă; încearcă din nou în scurt timp."),
    ("model_not_found", "Modelul `{model}` nu există sau nu ai acces la el."),
    ("unsupported_modality", "Acest model nu acceptă intrare de tip {missing}: niciun nod al lui nu o poate procesa."),
    ("rate_limited", "Limita de {what} a fost atinsă. Încearcă din nou în {secs} s."),
    ("context_exceeded", "Lungimea maximă a contextului acestui model este de {max} tokeni, dar cererea are nevoie de aproximativ {need} (prompt plus ieșirea cerută)."),
    ("no_node", "Niciun nod nu este disponibil pentru acest model acum."),
    ("model_is_embedding", "Modelul `{model}` este un model de embedding-uri: folosește /v1/embeddings."),
    ("model_is_chat", "Modelul `{model}` este un model de conversație, nu de embedding-uri: folosește /v1/chat/completions."),
    ("embedding_input_empty", "input trebuie să fie un șir nevid sau o listă nevidă de șiruri nevide."),
    ("embedding_too_many", "Cel mult {max} intrări per cerere."),
    ("embedding_input_long", "O intrare are mai mult de {max} de caractere."),
    ("embedding_bad_task", "Sarcină necunoscută `{task}`; folosește query, document, classification, clustering sau similarity."),
    ("embedding_bad_format", "encoding_format trebuie să fie `float` sau `base64`."),
    ("embedding_bad_dimensions", "dimensions trebuie să fie un număr pozitiv."),
    ("embedding_bad_answer", "Nodul a returnat un răspuns inutilizabil."),
    ("node_failed", "Nodul nu a reușit să răspundă."),
    ("node_error", "{message}"),
    ("node_disconnected", "Nodul s-a deconectat."),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiates_the_language() {
        assert_eq!(Lang::from_header(None), Lang::En);
        assert_eq!(Lang::from_header(Some("ro-RO,ro;q=0.9,en;q=0.8")), Lang::Ro);
        assert_eq!(Lang::from_header(Some("fr, en;q=0.5")), Lang::En);
        assert_eq!(Lang::from_header(Some("de")), Lang::En);
        assert_eq!(Lang::from_header(Some("en;q=0.4, ro;q=0.8")), Lang::Ro);
        assert_eq!(Lang::from_header(Some("ro;q=0")), Lang::En);
    }

    #[test]
    fn romanian_has_every_english_key() {
        for (k, _) in EN {
            assert!(RO.iter().any(|(r, _)| r == k), "missing Romanian text for {k}");
        }
        assert_eq!(EN.len(), RO.len());
    }

    #[test]
    fn fills_arguments_and_words() {
        let m = Tr::new("unsupported_modality").words("missing", vec!["word.image", "word.audio"]);
        assert_eq!(
            m.render(Lang::En),
            "This model does not accept image and audio input: no node of it can process it."
        );
        assert!(m.render(Lang::Ro).contains("imagine și audio"));
        let m = Tr::new("invalid_base64").word("what", "word.audio");
        assert_eq!(m.render(Lang::En), "The audio is not valid base64.");
    }
}
