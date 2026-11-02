import io, sys, os
sys.path.insert(0, r"C:\Users\18722\course-reader")
import server

print("EXAMS_FILE =", server.EXAMS_FILE)
cases = [
    "2026-11-05T09:00:00",
    "2026-11-05 09:00",
    "2026-02-30T09:00:00",
    "2026-11-05T25:00:00",
    "2026-11-05T09:00:00+08:00",
    "2026-11-05T09:00:00Z",
    "2026-11-05T09:00:00.123",
    "garbage",
]
for c in cases:
    print(repr(c), "->", server.exam_time_to_epoch(c))

errs, items = server.validate_exams([
    {"subject": " 高等数学 ", "examTime": "2026-11-05T09:00:00", "credit": 4, "focus": "积分"}])
print("ok:", errs, items)

errs2, _ = server.validate_exams([
    {"subject": "", "examTime": "x", "credit": "4", "focus": 1, "duration": -1}])
print("bad count:", len(errs2))
for e in errs2:
    print("  ", e)

errs3, _ = server.validate_exams("not a list")
print("non-list:", errs3)
