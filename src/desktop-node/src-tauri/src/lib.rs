mod engine;
mod storage;
mod system;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    let mut b = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(std::sync::Arc::new(engine::Engine::default()))
        .manage(system::Sampler::default())
        .manage(system::Awake::default());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        b = b
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--hidden"]),
            ));
    }

    b.invoke_handler(tauri::generate_handler![
        engine::engine_load,
        engine::engine_unload,
        engine::engine_generate,
        engine::engine_cancel,
        engine::engine_caps,
        storage::model_size,
        storage::model_write,
        storage::model_truncate,
        storage::model_sha256,
        storage::model_remove,
        storage::model_list,
        storage::secret_get,
        storage::secret_set,
        storage::secret_delete,
        system::device_info,
        system::telemetry,
        system::set_keep_awake,
        system::can_self_update,
    ])
    .setup(move |app| {
        let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &quit])?;
        let mut tray = TrayIconBuilder::new()
            .tooltip("SplitCortex Node")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, e| match e.id.as_ref() {
                "show" => show_main(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|t, e| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = e
                {
                    show_main(t.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
        if !hidden {
            show_main(app.handle());
        }
        Ok(())
    })
    // Closing the window keeps the node serving in the tray; "Quit" in the tray menu ends the app.
    .on_window_event(|window, event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    })
    .run(tauri::generate_context!())
    .expect("error while running the SplitCortex desktop node");
}
