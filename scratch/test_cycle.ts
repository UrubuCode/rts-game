import io from "@compat/io.ts";

class A {
  b: any = null;
}

class B {
  a: any = null;
}

let i = 0;
while (i < 500000) {
  const a = new A();
  const b = new B();
  a.b = b;
  b.a = a;
  i = i + 1;
}

io.print("Done 500k cycles without crashing!");
