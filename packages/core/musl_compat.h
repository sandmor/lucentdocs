/* BSD-style aliases used by sqlite-vec 0.1.9 on platforms where they are absent (e.g. musl). */
#include <stdint.h>

#ifndef u_int8_t
typedef uint8_t u_int8_t;
typedef uint16_t u_int16_t;
typedef uint64_t u_int64_t;
#endif
