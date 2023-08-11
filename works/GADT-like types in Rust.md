# GADT-like types in Rust

I think that GADTs are a very powerful feature of Haskell, and I would like to
have something similar in Rust. I think that the closest thing to GADTs in Rust.

GADTs are the generalized version of algebraic data types (ADTs or enums). In
ADTs, the type of the constructor is the same as the type of the data. In GADTs,
the type of the constructor is more general than the type of the data. This
allows us to express more complex types. In haskell, we can define a GADT like

```haskell
-- | A GADT for expressions with integers and booleans
-- and addition and equality operations with integers.
data Expr a where
  EInt :: Int -> Expr Int
  EBool :: Bool -> Expr Bool
  EAdd :: Expr Int -> Expr Int -> Expr Int
  EEq :: Expr Int -> Expr Int -> Expr Bool
```

In Rust, isn't possible to define this kind of types. The thing we can do, is
to define an algebraic data-type:

```rust
enum Expr {
  EInt(i32),
  EBool(bool),
  EAdd(Box<Expr>, Box<Expr>),
  EEq(Box<Expr>, Box<Expr>),
}
```

But we can't specify the type of the constructor. In Haskell, we can use the
kinds to specify the type of the constructor.

We have some kind of implementation already with
the [`refl` crate](https://crates.io/crates/refl), but they are
very limited, and verbose. The idea of this post, is showing a simpler and
idiomatic way to implement GADT-like types in rust, just like the `refl` crate.

## The problem

Why do we need GADT? Let's suppose that we want a type that have interior
mutability, but we want to possibly erase the mutability, just like, we have
a `Rc<RefCell<..>>` and we want to unwrap the `RefCell` and get a cloned version
of the value in a complex data structure? Just see an example:

```rust
enum Expr {
  /// Represents a variable in the source code that can be replaced
  /// by a value if the name is really defined.
  EVar(String, Rc<RefCell<Option<Expr>>>),
  EInt(i32),
  EAdd(Box<Expr>, Box<Expr>),
}
```
> You can take a look in a gist that have more complex data structures
> [here](https://gist.github.com/aripiprazole/eac8398def80731f2df3a192b1f6151a).

But why do we want to erase the `RefCell`? Because we want to have `Sync`, and
`Send` implementations for the type, and neither `RefCell`, neither `Rc` are
`Sync` or `Send`. We could have used `Arc<Mutex<...>>` or `Arc<RwLock<...>>` but
it would be more verbose, and we would need to use `lock()` every time we want
to access the value; and if we need a more complex type, just like a closure?
How we would implement it? We can't use `Arc<Mutex<...>>` because it's a
closure.

## The solution

The solution is using traits, and associated types. We can define a trait that
represents the type of the constructor, and then, we can use associated types
to define the type of the data. Let's see an example:

```rust
trait State {
  type Variable;
}
```

We can define a trait that represents the type of `EVar` constructor. Now, we
can define the type of the data:

```rust
enum Expr<S: State> {
  /// Represents a variable in the source code that can be replaced
  /// by a value if the name is really defined.
  EVar(String, S::Variable),
  EInt(i32),
  EAdd(Box<Expr>, Box<Expr>),
}
```

The `S::Variable` can be implemented by any type, and we can use it to define
with `Rc<RefCell<Option<Expr>>>`, and with just `Expr` if we want to erase the
`RefCell` and `Rc`, to be `Sync`, and `Send`!

## The implementation

We can implement the `State` trait for any type, and we can define for example,
two states, one state has mutability as previously said, and the other state
has no mutability. Let's see the implementation:

```rust
struct MutableState;

impl State for MutableState {
  type Variable = Rc<RefCell<Option<Expr<Self>>>>;
}

struct ImmutableState;

impl State for ImmutableState {
  type Variable = Expr<Self>;
}
```

And that's it! We can use the `Expr<MutableState>` and `Expr<ImmutableState>`
to represent the two different types of expressions. We can also define a
function that converts from `Expr<MutableState>` to `Expr<ImmutableState>`. To
be
able to do that, we need to define a trait that converts
from `Expr<MutableState>`.

## Other use cases

There some another cases that traits and GATs can be useful for simulating
GADTs:

1. Another use case that this kind of implementation is very useful, is when we
   want to
   define [HOAS (Higher-Order Abstract Syntax)](https://en.wikipedia.org/wiki/Higher-order_abstract_syntax)
   types, and create a dependently-typed system.
   <br>
   <br>

   HOAS can be very useful when we are building type systems, an example is
   [Lura](https://github.com/aripiprazole/lura)'s type system, that defines two
   states, one state for HOAS, and another state for the Quoted types.
   <br>
   <br>

   You can have a full look at the
   implementation [here](https://gist.github.com/aripiprazole/2be7584833a2fbf986e9dc27dfeb670e).
   The case of HOAS is very similar to the case of the `Expr` type, but instead
   I need to use closures and `Rc`.

## Conclusion

The conclusion is the following: we can use traits and associated types to
simulate GADTs in Rust. But not fully, but is already very powerful when we have
some complex types that we want to implement, and we want to erase some
information, just like the `RefCell` and `Rc` in the `Expr` type.

Thank you for reading! :)
