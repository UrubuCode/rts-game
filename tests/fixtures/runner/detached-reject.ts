console.log("PASS runner fixture");
Promise.resolve(1).then(() => { throw new Error("RUNNER_EXPECTED_DETACHED_FAILURE"); });
