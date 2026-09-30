import io from "@compat/io.ts";

class A {
  b: any = null;
  arr: number[] = new Array(100).fill(1);
}
class B {
  a: any = null;
  arr: number[] = new Array(100).fill(2);
}

for (let i = 0; i < 20000; i++) {
  const a = new A();
  const b = new B();
  a.b = b;
  b.a = a;
}

io.print("PASSOU CYCLES!");
