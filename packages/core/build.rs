fn main() {
  napi_build::setup();

  if std::env::var("CARGO_FEATURE_SQLITE_BUNDLED").is_ok() {
    println!("cargo:warning=core: using bundled SQLite (static sqlite-vec)");
    return;
  }

  match pkg_config::Config::new().probe("sqlite3") {
    Ok(lib) => {
      println!(
        "cargo:warning=core: using system SQLite {} from {}",
        lib.version,
        lib.link_paths
          .first()
          .map(|path| path.display().to_string())
          .unwrap_or_else(|| "pkg-config".to_string())
      );
    }
    Err(error) => {
      println!(
        "cargo:warning=core: system SQLite not found ({error}); rebuild with --features sqlite-bundled"
      );
    }
  }
}
