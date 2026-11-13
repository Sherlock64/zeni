fn main() {
    // `sqlx::migrate!` embeds the migrations, so rebuild when they change.
    println!("cargo:rerun-if-changed=migrations");
    tauri_build::build()
}
