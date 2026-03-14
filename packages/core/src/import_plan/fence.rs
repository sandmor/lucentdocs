#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FenceMarker {
  Backtick,
  Tilde,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Fence {
  marker: FenceMarker,
  length: usize,
}

pub(crate) fn is_fence_line(line: &str) -> Option<Fence> {
  let trimmed = line.trim_start();
  let mut chars = trimmed.chars();
  let first = chars.next()?;
  let marker = match first {
    '`' => FenceMarker::Backtick,
    '~' => FenceMarker::Tilde,
    _ => return None,
  };

  let mut length = 1usize;
  for c in chars {
    if c == first {
      length += 1;
    } else {
      break;
    }
  }

  if length < 3 {
    return None;
  }

  Some(Fence { marker, length })
}

pub(crate) fn update_fence_state(current: &mut Option<Fence>, line: &str) {
  let fence = match is_fence_line(line) {
    Some(f) => f,
    None => return,
  };

  match current {
    None => {
      *current = Some(fence);
    }
    Some(open) => {
      if open.marker == fence.marker && fence.length >= open.length {
        *current = None;
      }
    }
  }
}
