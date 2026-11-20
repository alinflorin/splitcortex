//! Embeddings: the second capability of the engine, next to chat. A pool whose model has kind "embedding" is loaded into
//! LiteRT-LM's embedding engine (never the chat engine). This file is the model-independent part: the task prefixes,
//! the Matryoshka truncation with renormalisation, and the batch handling, all behind the `Embedder` trait so they are
//! tested with a fake. Port of `src/desktop-node/src/engine/embed.ts`-style logic: a fix in one must be made in the other.
//! Texts and vectors are never logged.

/// Why an embedding request failed: the input is the problem (the gateway may show it to the client), or the engine.
#[derive(Debug, PartialEq, Eq)]
pub struct EmbedError {
    /// The `InferenceError` code.
    pub code: &'static str,
    pub message: String,
}

impl EmbedError {
    pub fn bad_input(message: impl Into<String>) -> Self {
        EmbedError {
            code: "bad_input",
            message: message.into(),
        }
    }
    pub fn engine(message: impl Into<String>) -> Self {
        EmbedError {
            code: "engine_error",
            message: message.into(),
        }
    }
}

/// What the loaded embedding model does with a list of texts (already prefixed): one L2-normalised vector per text.
pub trait Embedder {
    fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError>;
}

/// The task prefix EmbeddingGemma expects (model card, "Prompt instructions"); "" = none. `None` for an unknown task.
pub fn task_prefix(task: &str) -> Option<&'static str> {
    Some(match task {
        "" => "",
        "query" => "task: search result | query: ",
        "document" => "title: none | text: ",
        "classification" => "task: classification | query: ",
        "clustering" => "task: clustering | query: ",
        "similarity" => "task: sentence similarity | query: ",
        _ => return None,
    })
}

/// Truncates to `dimensions` and renormalises (L2) when 0 < dimensions < the full length; otherwise unchanged.
pub fn truncate_and_normalise(mut v: Vec<f32>, dimensions: usize) -> Vec<f32> {
    if dimensions == 0 || dimensions >= v.len() {
        return v;
    }
    v.truncate(dimensions);
    let norm = v
        .iter()
        .map(|x| (*x as f64) * (*x as f64))
        .sum::<f64>()
        .sqrt();
    if norm > 0.0 {
        for x in &mut v {
            *x = (*x as f64 / norm) as f32;
        }
    }
    v
}

/// Answers one `EmbeddingRequest`: trims every input, writes the model's task prefix, embeds the batch and applies
/// `dimensions`. One vector per input, in order.
pub fn embed_request(
    embedder: &dyn Embedder,
    inputs: &[String],
    task: &str,
    dimensions: u32,
) -> Result<Vec<Vec<f32>>, EmbedError> {
    if inputs.is_empty() {
        return Err(EmbedError::bad_input("There is nothing to embed"));
    }
    let prefix = task_prefix(task)
        .ok_or_else(|| EmbedError::bad_input(format!("Unknown embedding task \"{task}\"")))?;
    let texts: Vec<String> = inputs
        .iter()
        .map(|t| format!("{prefix}{}", t.trim()))
        .collect();
    let out = embedder.embed_batch(&texts)?;
    if out.len() != texts.len() {
        return Err(EmbedError::engine(
            "The engine returned a different number of embeddings than inputs",
        ));
    }
    Ok(out
        .into_iter()
        .map(|v| truncate_and_normalise(v, dimensions as usize))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Echoes the text length as a vector and remembers what it was asked.
    struct Fake {
        seen: Mutex<Vec<String>>,
        dim: usize,
    }
    impl Embedder for Fake {
        fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
            self.seen.lock().unwrap().extend(texts.iter().cloned());
            Ok(texts
                .iter()
                .map(|t| (0..self.dim).map(|i| (t.len() + i + 1) as f32).collect())
                .collect())
        }
    }
    fn fake(dim: usize) -> Fake {
        Fake {
            seen: Mutex::default(),
            dim,
        }
    }
    fn strings(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn every_task_has_its_embeddinggemma_prefix() {
        assert_eq!(task_prefix(""), Some(""));
        assert_eq!(task_prefix("query"), Some("task: search result | query: "));
        assert_eq!(task_prefix("document"), Some("title: none | text: "));
        assert_eq!(
            task_prefix("classification"),
            Some("task: classification | query: ")
        );
        assert_eq!(
            task_prefix("clustering"),
            Some("task: clustering | query: ")
        );
        assert_eq!(
            task_prefix("similarity"),
            Some("task: sentence similarity | query: ")
        );
        assert_eq!(task_prefix("nope"), None);
    }

    #[test]
    fn inputs_are_trimmed_then_prefixed_in_order() {
        let f = fake(4);
        let out = embed_request(&f, &strings(&["  hello \n", "world"]), "query", 0).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(
            *f.seen.lock().unwrap(),
            strings(&[
                "task: search result | query: hello",
                "task: search result | query: world"
            ])
        );
        let f = fake(4);
        embed_request(&f, &strings(&[" x "]), "", 0).unwrap();
        assert_eq!(*f.seen.lock().unwrap(), strings(&["x"]));
    }

    #[test]
    fn dimensions_truncate_and_renormalise_only_below_the_full_size() {
        let v = vec![3.0, 4.0, 12.0, 0.0];
        let t = truncate_and_normalise(v.clone(), 2);
        assert_eq!(t.len(), 2);
        assert!((t[0] - 0.6).abs() < 1e-6 && (t[1] - 0.8).abs() < 1e-6);
        assert_eq!(truncate_and_normalise(v.clone(), 0), v);
        assert_eq!(truncate_and_normalise(v.clone(), 4), v);
        assert_eq!(truncate_and_normalise(v.clone(), 99), v);
        // a zero vector stays zero instead of becoming NaN
        assert_eq!(
            truncate_and_normalise(vec![0.0, 0.0, 1.0], 2),
            vec![0.0, 0.0]
        );
        let f = fake(8);
        let out = embed_request(&f, &strings(&["a"]), "", 3).unwrap();
        assert_eq!(out[0].len(), 3);
        let n: f32 = out[0].iter().map(|x| x * x).sum();
        assert!((n - 1.0).abs() < 1e-5);
    }

    #[test]
    fn bad_requests_are_refused_before_the_engine() {
        let f = fake(2);
        assert_eq!(embed_request(&f, &[], "", 0).unwrap_err().code, "bad_input");
        assert_eq!(
            embed_request(&f, &strings(&["a"]), "weird", 0)
                .unwrap_err()
                .code,
            "bad_input"
        );
        assert!(f.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn engine_failures_and_miscounts_become_errors() {
        struct Broken;
        impl Embedder for Broken {
            fn embed_batch(&self, _: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
                Err(EmbedError::engine("boom"))
            }
        }
        assert_eq!(
            embed_request(&Broken, &strings(&["a"]), "", 0)
                .unwrap_err()
                .code,
            "engine_error"
        );
        struct Short;
        impl Embedder for Short {
            fn embed_batch(&self, _: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
                Ok(vec![vec![1.0]])
            }
        }
        assert!(embed_request(&Short, &strings(&["a", "b"]), "", 0).is_err());
    }
}
